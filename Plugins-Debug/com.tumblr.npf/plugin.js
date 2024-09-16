
// com.tumblr

function verify() {
	sendRequest(site + "/v2/user/info")
	.then((text) => {
		const jsonObject = JSON.parse(text);
		
		const blogs = jsonObject.response.user.blogs;
		const blog = blogs[0];
		
		const displayName = blog.name;
		const icon = "https://api.tumblr.com/v2/blog/" + blog.name + "/avatar/96";

		const verification = {
			displayName: displayName,
			icon: icon
		};
		processVerification(verification);
	})
	.catch((requestError) => {
		processError(requestError);
	});
}

function postForItem(item) {
	if (item.type != "blocks") {
		return null;
	}
	
	let isReblog = false;
	if (item.parent_post_url != null) {
		isReblog = true;
	}
	if (isReblog && includeReblogs != "on") {
		return null;
	}
	
	const date = new Date(item.timestamp * 1000); // timestamp is seconds since the epoch, convert to milliseconds

	let contentUrl = item.post_url;
	let contentItem = item;
	let contentBlocks = contentItem.content;
	let contentLayouts = contentItem.layout;
	
	let annotation = null;
	if (isReblog) {
		if (item.trail != null && item.trail.length > 0) {
			let trailOrigin = item.trail[0];
			
			const itemBlog = item.blog;
			const userName = itemBlog.name;
			const text = "Reblogged by " + userName;
			annotation = Annotation.createWithText(text);
			annotation.icon = "https://api.tumblr.com/v2/blog/" + itemBlog.name + "/avatar/96";
			annotation.uri = item.post_url;
			
			contentItem = trailOrigin;
			contentBlocks = contentItem.content;
			contentLayouts = contentItem.layout;
			
// 			if (contentItem.blog.url != null && contentItem.post.id != null) {
// 				contentUrl = contentItem.blog.url + "/" + contentItem.post.id;
// 			}
		}
	}
	
	if (contentItem.blog != null) {
		const blog = contentItem.blog;
		identity = Identity.createWithName(blog.name);
		identity.uri = blog.url;
		identity.username = blog.title;
		identity.avatar = "https://api.tumblr.com/v2/blog/" + blog.name + "/avatar/96";
	}
	else {
		if (contentItem.broken_blog_name != null) {
			identity = Identity.createWithName(contentItem.broken_blog_name);
		}
		else {
			console.log(`**** no blog for '${item.summary}' ${item.post_url}`);
		}
	}
	
	let body = "";
	let attachments = [];
	console.log(`contentBlocks.length = ${contentBlocks.length}`);
	let blockIndex = 0;
	for (const contentBlock of contentBlocks) {
		console.log(`  [${blockIndex}] contentBlock.type = ${contentBlock.type}`);
		switch (contentBlock.type) {
		case "text":
			let text = contentBlock.text;
			let textFormats = contentBlock.formatting;
			if (textFormats != null && textFormats.length > 0) {
			
				console.log(`    text = ${text}`);
				let codeUnits = Array.from(text);
				console.log(`    codeUnits = ${codeUnits}`);
				let codePoints = codeUnits.map((codeUnit) => codeUnit.codePointAt());
				
				let codePointOffset = 0;
				for (const textFormat of textFormats) {
					const start = textFormat.start;
					const end = textFormat.end;
					
					switch (textFormat.type) {
					case "bold":
						codePoints.splice(end + codePointOffset, 0, 60, 47, 98, 62); // insert </b> at end of range
						codePoints.splice(start + codePointOffset, 0, 60, 98, 62); // insert <b> at beginning of range 
						codePointOffset += 7; // number of code points added above
						break;
					case "italic":
						codePoints.splice(end + codePointOffset, 0, 60, 47, 105, 62); // insert </i> at end of range
						codePoints.splice(start + codePointOffset, 0, 60, 105, 62); // insert <i> at beginning of range 
						codePointOffset += 7; // number of code points added above
						break;
					}
				}
					
				console.log(`    codePoints = ${codePoints}`);
				let convertedText = String.fromCodePoint(...codePoints);
				console.log(`    convertedText = ${convertedText}`);
				text = convertedText;
			}
			
			let askLayout = contentLayouts.find(({ type }) => type === "ask");
			if (askLayout != null && askLayout.blocks.indexOf(blockIndex) != -1) {
				// text is an ask, style it with a blockquote
				let asker = "Anonymous";
				if (askLayout.blog != null) {
					asker = askLayout.blog.name;
				}
				body += `<blockquote><p><strong>${asker}</strong> asked:</p><p>${text}</p></blockquote>`;
			}
			else {
				body += `<p>${text}</p>`;
			}
			break;
		case "image":
			if (contentBlock.media != null && contentBlock.media.length > 0) {
				const mediaProperties = contentBlock.media[0];
				const posterProperties = mediaProperties.poster;

				const attachment = MediaAttachment.createWithUrl(mediaProperties.url);
				attachment.text = contentBlock.alt_text;
				attachment.mimeType = mediaProperties.type;
				attachment.aspectSize = {width: mediaProperties.width, height: mediaProperties.height};
				if (posterProperties != null) {
					attachment.thumbnail = posterProperties.url;
				}
				attachments.push(attachment);
			}
			break;
		case "link":
			if (contentBlock.url != null) {
				let attachment = LinkAttachment.createWithUrl(contentBlock.url);
				if (contentBlock.title != null && contentBlock.title.length > 0) {
					attachment.title = contentBlock.title;
				}
				if (contentBlock.description != null && contentBlock.description.length > 0) {
					attachment.subtitle = contentBlock.description;
				}
				if (contentBlock.author != null && contentBlock.author.length > 0) {
					attachment.authorName = contentBlock.author;
				}
				if (contentBlock.poster != null && contentBlock.poster.length > 0) {
					let poster = contentBlock.poster[0];
					if (poster.url != null) {
						attachment.image = poster.url;
					}
					if (poster.width != null && poster.height != null) {
						attachment.aspectSize = {width : poster.width, height: poster.height};
					}
				}
				attachments.push(attachment);
			}
			break;
		case "audio":
			if (contentBlock.media != null) {
				const mediaProperties = contentBlock.media;
				const posterProperties = contentBlock.poster;

				// TODO: Check contentBlock.provider and use embed_html if not "tumblr"
				
				const attachment = MediaAttachment.createWithUrl(mediaProperties.url);
				attachment.mimeType = mediaProperties.type;
				attachment.aspectSize = {width: mediaProperties.width, height: mediaProperties.height};
				if (posterProperties != null && posterProperties.length > 0) {
					attachment.thumbnail = posterProperties[0].url;
				}
				attachments.push(attachment);
			}
			else if (contentBlock.url != null) {
				const attachment = MediaAttachment.createWithUrl(contentBlock.url);
				attachments.push(attachment);
			}
			break;
		case "video":
			if (contentBlock.media != null) {
				const mediaProperties = contentBlock.media;
				const posterProperties = contentBlock.poster;

				// TODO: Check contentBlock.provider and use embed_html if not "tumblr"
				
				const attachment = MediaAttachment.createWithUrl(mediaProperties.url);
				attachment.mimeType = mediaProperties.type;
				attachment.aspectSize = {width: mediaProperties.width, height: mediaProperties.height};
				if (posterProperties != null && posterProperties.length > 0) {
					attachment.thumbnail = posterProperties[0].url;
				}
				attachments.push(attachment);
			}
			else if (contentBlock.url != null) {
				const attachment = MediaAttachment.createWithUrl(contentBlock.url);
				attachments.push(attachment);
			}
			break;
// 		case "paywall":
// 			break;
		default:
			body += `Cannot display ${contentBlock.type} content.`;
		}
		
		blockIndex += 1;
	}
	
	if (includeTags == "on") {
		if (contentItem.tags != null && contentItem.tags.length > 0) {
			body += "<p>";
			for (const tag of contentItem.tags) {
				body += `<a href="https://www.tumblr.com/tagged/${encodeURIComponent(tag)}">#${tag}</a> `;
			}
			body += "</p>";
		}
	}

	const post = Item.createWithUriDate(contentUrl, date);
	post.body = body;
	if (identity != null) {
		post.author = identity;
	}
	if (attachments.length != 0) {
		post.attachments = attachments
	}
	if (annotation != null) {
		post.annotations = [annotation];
	}
	return post;
}

function queryDashboard(doIncrementalLoad) {

	return new Promise((resolve, reject) => {

		// this function is called recursively to load & process batches of posts into a single list of results
		function requestToId(id, doIncrementalLoad, resolve, reject, limit = 5, results = []) {
			let url = null
			if (id == null) {
				console.log("offset = none");
				url = `${site}/v2/user/dashboard?npf=true&reblog_info=true&notes_info=true&limit=20`;
			}
			else {
				const offset = (requestLimit - limit) * 20;
				console.log(`offset = ${offset}`);
				url = `${site}/v2/user/dashboard?npf=true&reblog_info=true&notes_info=true&limit=20&offset=${offset}`;
			}
			
			console.log(`doIncrementalLoad = ${doIncrementalLoad}, id = ${id}`);
			
			sendRequest(url, "GET")
			.then((text) => {
				//console.log(text);
				let lastId = null;
				
				const jsonObject = JSON.parse(text);
				const items = jsonObject.response.posts;
				for (const item of items) {
					const post = postForItem(item);
					if (post != null) {
						results.push(post);
						lastId = item["id"];
					}
				}
				
				const newLimit = limit - 1;
				
				if (lastId != null && newLimit > 0 && doIncrementalLoad == false) {
					requestToId(lastId, doIncrementalLoad, resolve, reject, newLimit, results);
				}
				else {
					resolve(results);
				}
			})
			.catch((error) => {
				reject(error);
			});	
		}

		const requestLimit = 10;
		requestToId(null, doIncrementalLoad, resolve, reject, requestLimit);

	});
	
}

// TODO: FOR TESTING ONLY
//var doIncrementalLoad = false;
var doIncrementalLoad = true;

function load() {
	queryDashboard(doIncrementalLoad)
	.then((results) =>  {
		console.log(`finished dashboard`);
		processResults(results, true);
		doIncrementalLoad = true;
	})
	.catch((requestError) => {
		console.log(`error dashboard`);
		processError(requestError);
		doIncrementalLoad = false;
	});	
}

// returns the number of Unicode code points in a JavaScript string
// derived from: https://coolaj86.com/articles/how-to-count-unicode-characters-in-javascript/
function countCodePoints(str) {
	let len = 0;
	let index = 0;
	while (index < str.length) {
		let point = str.codePointAt(index);
      	let width = 0;
		while (point) {
			width += 1;
			point = point >> 8;
		}
		index += Math.round(width/2);
		len += 1;
	}
	return len;
}