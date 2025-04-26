// com.nitter.list

/// <reference path="../tapestry.d.ts" />

const debug = false;
const maxInterval = 3 * 24 * 60 * 60 * 1000; // 3 days in milliseconds
const maxItems = 800;

function verify() {
    const feedHost = site.split("/")[2];
    const displayName = `X ${feedName} (${feedHost})`;
    const icon = "https://x.com/favicon.ico";
    setItem("feedHost", feedHost);
    setItem(`profileCache_${feedName}`, "{}");
     setItem(`endDateTimestamp_${feedName}`, null);
    processVerification({
        displayName: displayName,
        icon: icon,
    });
}

async function load() {
    if (debug) {
        setItem(`endDateTimestamp_${feedName}`, null);
    }
    feedAccounts = feedAccounts.replace(/\s+/g, ""); // Remove whitespace
    let results = [];
    try {
        // Retrieve the endDateTimestamp from storage
        let endDate = null;
        let endDateTimestamp = getItem(`endDateTimestamp_${feedName}`);
        if (endDateTimestamp != null) {
            endDate = new Date(parseInt(endDateTimestamp));
        } else {
            endDate = new Date(Date.now() - maxInterval); // Default to maxInterval
        }

        // Fetch items using the queryNitterFeed function
        const [fetchedItems, newestItemDate] = await queryNitterFeed(feedAccounts, endDate);
        results = fetchedItems;

        // Update the endDateTimestamp with the newest item's date
        if (newestItemDate) {
            setItem(`endDateTimestamp_${feedName}`, String(newestItemDate.getTime()));
        }
    } catch (error) {
        processError(error);
    }
    processResults(results);
}

async function queryNitterFeed(feedAccounts, endDate) {
    let newestItemDate = null;

    return new Promise((resolve, reject) => {
        async function fetchBatch(feedUrl, results = []) {
            try {
                // Fetch the RSS feed with full response to access headers
                let rssFull = await sendRequest(feedUrl, "GET", null, {}, true);
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

                    // If any item is after the endDate, set the flag to false
                    if (!endDate || rssItemDate >= endDate) {
                        allItemsBeforeEndDate = false;

                        // Process the RSS item
                        const item = await processRssItem(rssItem, rssItemDate);
                        results.push(item);

                        // Stop if the maximum number of items is reached
                        if (results.length >= maxItems) {
                            resolve([results, newestItemDate]);
                            return;
                        }
                    }
                }

                // If all items in the batch are before the endDate, stop fetching
                if (allItemsBeforeEndDate) {
                    resolve([results, newestItemDate]);
                    return;
                }

                // Get the "min-id" from the RSS feed's headers for pagination
                const minId = rssFull.headers["min-id"];
                if (minId) {
                    const nextFeedUrl = `${site}/${feedAccounts}/rss?max_position=${minId}`;
                    await fetchBatch(nextFeedUrl, results);
                } else {
                    // No more pages to fetch
                    resolve([results, newestItemDate]);
                }
            } catch (error) {
                reject(error);
            }
        }

        fetchBatch(`${site}/${feedAccounts}/rss`);
    });
}

async function processRssItem(rssItem, rssItemDate) {
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
    let rssItemQuoteTweetProperties = {}
    const quoteTweetUrlRegex = new RegExp(`href="(https?:\\/\\/[^"]*\\.?${rssHost.replace('.', '\\.')}[^"]*#m)"`, "i");
    const quoteTweetUrlMatch = rssItemDescription.match(quoteTweetUrlRegex);
    if (quoteTweetUrlMatch) {
        rssItemQuoteTweetUrl = quoteTweetUrlMatch[1];
        const quoteTweetHtml = await sendRequest(rssItemQuoteTweetUrl);
        rssItemQuoteTweetProperties = extractProperties(quoteTweetHtml);
    }

    // Required fields
    // let itemUri = rssItemLink;
    // let itemDate = new Date(rssItemDate);

    // Optional fields
    // let itemBody = rssItemDescription;
    let itemAuthor;
    let itemAnnotations = [];
    let itemAttachments = [];

    let profileCache = await getCachedProfile(rssItemAccount);
    let authorName = profileCache["fullName"];
    itemAuthor = Identity.createWithName(authorName);
    itemAuthor.uri = `${site}/${rssItemAccount}`
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
    item.body = rssItemDescription
    item.author = itemAuthor
    item.annotations = itemAnnotations;
    item.attachments = itemAttachments;

    return item
}


async function getCachedProfile(account) {
    let profileCacheStr = getItem(`profileCache_${feedName}`);
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
        setItem(`profileCache_${feedName}`, profileCacheStr);
    }
    return profileCache[account];
}