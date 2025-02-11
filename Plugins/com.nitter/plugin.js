
// com.nitter

function verify() {
	const rssUrl = `${site}/rss`;
	sendRequest(rssUrl)
	.then((xml) => {	
		let jsonObject = xmlParse(xml);
		const title = jsonObject.rss.channel.title;
		if (title.includes("RSS") && title.includes("whitelist")) {
			processError(Error(title));
		}
		const baseUrl = jsonObject.rss.channel.link;
		const feedAccount = title.split(" / ")[1];
		const icon = jsonObject.rss.channel.image?.url;
		const feedHost = site.split("/")[2];
		const displayName = `X ${feedAccount} (${feedHost})`;
		processVerification({
			displayName: displayName,
			icon: icon,
			baseUrl: baseUrl
		});
	})
	.catch((requestError) => {
		processError(requestError);
	});
}

function load() {	
	const rssUrl = `${site}/rss`;
	sendRequest(rssUrl)
	.then((xml) => {
		let jsonObject = xmlParse(xml);
		const title = jsonObject.rss.channel.title;
		if (title.includes("RSS") && title.includes("whitelist")) {
			processError(Error(title));
		}
		const feedUrl = jsonObject.rss.channel.link;
		const [feedName, feedAccount] = jsonObject.rss.channel.title.split(" / ");
		const feedIcon = jsonObject.rss.channel.image?.url;
		let items = [];
		if (jsonObject.rss.channel.item != null) {
			const item = jsonObject.rss.channel.item;
			if (item instanceof Array) {
				items = item;
			}
			else {
				items = [item];
			}
		}
		let results = [];
		for (const item of items) {
			const itemDate = item["pubDate"] ?? item["dc:date"];
			const url = item.link;
			const date = new Date(itemDate);
			let content = item.description;

			let authorName = item["dc:creator"];
			let identity = Identity.createWithName(authorName);
			identity.uri = feedUrl;
			identity.name = feedName;
			identity.username = feedAccount;
			identity.avatar = feedIcon;

			const resultItem = Item.createWithUriDate(url, date);
			resultItem.body = content;
			resultItem.author = identity;
			results.push(resultItem);
		}
		processResults(results);
	})
	.catch((requestError) => {
		processError(requestError);
	});	
}
