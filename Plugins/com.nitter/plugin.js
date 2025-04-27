// com.nitter

/// <reference path="../tapestry.d.ts" />

// Constants
const debug = false; // Debug mode flag
const maxInterval = 3 * 24 * 60 * 60 * 1000; // 3 days in milliseconds
const maxItems = 800; // Maximum number of items to fetch
const maxRetries = 3; // Maximum number of retry attempts
const retryDelay = 2000; // Delay between retries in milliseconds

/**
 * Verifies the Nitter feed and initializes necessary settings.
 */
function verify() {
    const feedHost = site.split("/")[2]; // Extract the host from the site URL
    const displayName = `X ${feedName} (${feedHost})`; // Display name for the feed
    const icon = "https://x.com/favicon.ico"; // Default icon for the feed

    // Store feed host and initialize profile cache
    setItem("feedHost", feedHost);
    setItem("profileCache", "{}"); // Initialize profile cache
    setItem("endDateTimestamp", null); // Reset the endDateTimestamp

    // Process verification with display name and icon
    processVerification({
        displayName: displayName,
        icon: icon,
    });
}

/**
 * Main load function to fetch and process Nitter feed items.
 * This is the entry point required by the Tapestry interface.
 */
async function load() {
    if (debug) {
        setItem("endDateTimestamp", null); // Reset endDateTimestamp in debug mode
    }

    feedAccounts = feedAccounts.replace(/\s+/g, ""); // Remove whitespace from feed accounts
    let results = [];
    let newestItemDate = null;

    try {
        // Retrieve the endDateTimestamp from storage
        let endDate = null;
        let endDateTimestamp = getItem("endDateTimestamp");
        if (endDateTimestamp != null) {
            endDate = new Date(parseInt(endDateTimestamp)); // Parse the stored timestamp
        } else {
            endDate = new Date(Date.now() - maxInterval); // Default to maxInterval
        }

        // Fetch all items using the fetchAllFeedItems function
        const fetchedItems = await fetchAllRssFeedItems(feedAccounts, endDate);

        // Process additional details for the fetched items
        results = await processRssItemDetails(fetchedItems);

        // Update the endDateTimestamp with the most recent successfully processed item's date
        if (results.length > 0) {
            newestItemDate = results[results.length - 1].date; // Last item is the most recent
            setItem("endDateTimestamp", String(new Date(newestItemDate).getTime()));
        }
    } catch (error) {
        console.error("Error during load:", error);
    }

    // Process whatever results were successfully retrieved
    processResults(results);
}

/**
 * Fetches all items from the Nitter feed, handling pagination.
 * Only items newer than the provided endDate are included.
 * @param {string} feedAccounts - The feed accounts to fetch.
 * @param {Date} endDate - The cutoff date for fetching items.
 * @returns {Promise<[Array, Date]>} - A promise resolving to the fetched items and the newest item's date.
 */
async function fetchAllRssFeedItems(feedAccounts, endDate) {
    let newestItemDate = null;
    let allResults = []; // Store all fetched items without processing details

    return new Promise((resolve, reject) => {
        async function fetchBatch(feedUrl, attempt = 1) {
            try {
                // Fetch the RSS feed with full response to access headers
                let rssFull = await sendRequestWithRetry(feedUrl, "GET", null, {}, true);
                rssFull = JSON.parse(rssFull);
                const rssJson = xmlParse(rssFull.body);

                let rssItems = [];
                if (rssJson.rss.channel.item != null) {
                    const rssItem = rssJson.rss.channel.item;
                    rssItems = Array.isArray(rssItem) ? rssItem : [rssItem];
                }

                let allItemsBeforeEndDate = true; // Flag to check if all items are before the endDate

                for (const rssItem of rssItems) {
                    const rssItemDate = new Date(rssItem["pubDate"] ?? rssItem["dc:date"]);

                    // Update the newestItemDate
                    if (!newestItemDate || rssItemDate > newestItemDate) {
                        newestItemDate = rssItemDate;
                    }

                    // Include only items strictly newer than the endDate
                    if (!endDate || rssItemDate > endDate) {
                        allItemsBeforeEndDate = false;
                        allResults.push({ rssItem, rssItemDate }); // Store raw item and date
                    }
                }

                // If all items in the batch are before the endDate, stop fetching
                if (allItemsBeforeEndDate) {
                    resolve(allResults);
                    return;
                }

                // Get the "min-id" from the RSS feed's headers for pagination
                const minId = rssFull.headers["min-id"];
                if (minId) {
                    const nextFeedUrl = `${site}/${feedAccounts}/rss?max_position=${minId}`;
                    await fetchBatch(nextFeedUrl);
                } else {
                    // No more pages to fetch
                    resolve(allResults);
                }
            } catch (error) {
                if (attempt < maxRetries) {
                    console.log(`Retrying (${attempt}/${maxRetries})...`);
                    setTimeout(() => fetchBatch(feedUrl, attempt + 1), retryDelay);
                } else {
                    reject(new Error(`Failed after ${maxRetries} attempts: ${error.message}`));
                }
            }
        }

        fetchBatch(`${site}/${feedAccounts}/rss`);
    });
}

/**
 * Processes additional details for fetched items after pagination is complete.
 * Items are processed starting with the oldest.
 * @param {Array} items - The raw RSS items to process.
 * @returns {Array} - The processed items.
 */
async function processRssItemDetails(items) {
    let processedItems = [];

    // Sort items by date (oldest first)
    items.sort((a, b) => new Date(a.rssItemDate) - new Date(b.rssItemDate));

    for (const { rssItem, rssItemDate } of items) {
        try {
            const processedItem = await rssItemToTapestryItem(rssItem, rssItemDate);
            processedItems.push(processedItem);
        } catch (error) {
            console.error(`Error processing item:`, error);
            break; // Stop processing further details if an error occurs
        }
    }

    return processedItems;
}

/**
 * Sends a request with retry logic.
 * @param {string} url - The URL to send the request to.
 * @param {string} method - The HTTP method to use.
 * @param {object|null} body - The request body.
 * @param {object} headers - The request headers.
 * @param {boolean} fullResponse - Whether to return the full response.
 * @param {number} attempt - The current retry attempt.
 * @returns {Promise<any>} - The response from the request.
 */
async function sendRequestWithRetry(url, method, body = null, headers = {}, fullResponse = false, attempt = 1) {
    try {
        return await sendRequest(url, method, body, headers, fullResponse);
    } catch (error) {
        if (attempt < maxRetries) {
            console.log(`Request failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
            return sendRequestWithRetry(url, method, body, headers, fullResponse, attempt + 1);
        } else {
            throw new Error(`Request failed after ${maxRetries} attempts: ${error.message}`);
        }
    }
}

/**
 * Processes an individual RSS item into a Tapestry-compatible format.
 * @param {object} rssItem - The RSS item to process.
 * @param {Date} rssItemDate - The publication date of the RSS item.
 * @returns {Promise<object>} - The processed item.
 */
async function rssItemToTapestryItem(rssItem, rssItemDate) {
    const rssHost = getItem("feedHost");
    const rssItemCreator = rssItem["dc:creator"] ?? null;
    const rssItemTitle = rssItem["title"] ?? null;
    const rssItemDescription = rssItem["description"] ?? null;
    const rssItemLink = rssItem["link"] ?? null;
    const rssItemAccount = rssItemCreator ? rssItemCreator.replace(/^@/, "") : null;

    // Check for Retweet
    let rssItemRetweetAccount = null;
    const retweet = rssItemTitle?.match(/^RT by @([a-zA-Z0-9_]+):/);
    if (retweet) {
        rssItemRetweetAccount = retweet[1];
    }

    // Check for Quote Tweet
    let rssItemQuoteTweetUrl = null;
    let rssItemQuoteTweetProperties = {};
    const quoteTweetUrlRegex = new RegExp(`href="(https?:\\/\\/[^"]*\\.?${rssHost.replace('.', '\\.')}[^"]*#m)"`, "i");
    const quoteTweetUrlMatch = rssItemDescription.match(quoteTweetUrlRegex);
    if (quoteTweetUrlMatch) {
        rssItemQuoteTweetUrl = quoteTweetUrlMatch[1];
        const quoteTweetHtml = await sendRequestWithRetry(rssItemQuoteTweetUrl, "GET");
        rssItemQuoteTweetProperties = extractProperties(quoteTweetHtml);
    }

    let itemAuthor;
    let itemAnnotations = [];
    let itemAttachments = [];

    let profileCache = await getCachedProfile(rssItemAccount);
    let authorName = profileCache["fullName"];
    itemAuthor = Identity.createWithName(authorName);
    itemAuthor.uri = `${site}/${rssItemAccount}`;
    itemAuthor.username = `@${rssItemAccount}`;
    itemAuthor.avatar = profileCache["avatarUrl"];

    if (rssItemRetweetAccount) {
        itemAnnotations.push(Annotation.createWithText(`Retweeted by @${rssItemRetweetAccount}`));
    }

    if (rssItemQuoteTweetUrl) {
        let quoteTweetAttachment = LinkAttachment.createWithUrl(rssItemQuoteTweetUrl);
        if (rssItemQuoteTweetProperties["og:title"]) {
            quoteTweetAttachment.title = rssItemQuoteTweetProperties["og:title"];
        }
        if (rssItemQuoteTweetProperties["og:description"]) {
            quoteTweetAttachment.subtitle = rssItemQuoteTweetProperties["og:description"];
        }
        if (rssItemQuoteTweetProperties["og:image"]) {
            quoteTweetAttachment.image = rssItemQuoteTweetProperties["og:image"];
        }
        itemAttachments.push(quoteTweetAttachment);
    }

    const item = Item.createWithUriDate(rssItemLink, rssItemDate);
    item.body = rssItemDescription;
    item.author = itemAuthor;
    item.annotations = itemAnnotations;
    item.attachments = itemAttachments;

    return item;
}

/**
 * Retrieves a cached profile for a given account.
 * @param {string} account - The account to retrieve the profile for.
 * @returns {Promise<object>} - The cached profile.
 */
async function getCachedProfile(account) {
    let profileCacheStr = getItem("profileCache");
    if (!profileCacheStr) {
        profileCacheStr = "{}";
    }
    let profileCache = JSON.parse(profileCacheStr);
    if (!profileCache[account]) {
        const rssXml = await sendRequest(`${site}/${account}/rss`);
        const rssJson = xmlParse(rssXml);
        const fullName = rssJson.rss.channel.title.split(" / ")[0];
        const avatarUrl = rssJson.rss.channel.image?.url;
        profileCache[account] = { "fullName": fullName, "avatarUrl": avatarUrl };
        profileCacheStr = JSON.stringify(profileCache);
        setItem("profileCache", profileCacheStr);
    }
    return profileCache[account];
}