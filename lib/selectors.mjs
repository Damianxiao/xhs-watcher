// XHS DOM selectors — KEEP IN ONE PLACE.
// These need to be verified manually by opening the search page and inspecting
// the rendered DOM. Update as XHS frontend changes.

export const XHS = {
  // Search result feed (set of note cards)
  feedContainer: '.feeds-container, [class*="search-result"]',
  noteCard: 'section.note-item, [class*="note-item"]',

  // Within a card: extract these
  cardLink: 'a[href*="/explore/"], a[href*="/search_result/"]',
  cardTitle: '[class*="title"]',
  cardAuthor: '[class*="author"], [class*="user-name"]',
  cardRelativeTime: '[class*="time"], [class*="publish"]',
  cardLikes: '[class*="like"] [class*="count"]',

  // Detail page (after clicking into a note)
  detailContent: '#detail-desc, [class*="desc"]',
  detailTags: '[class*="tag-item"], [class*="hash-tag"]',
  detailMetrics: {
    likes: '[class*="like-wrapper"] [class*="count"]',
    collects: '[class*="collect-wrapper"] [class*="count"]',
    comments: '[class*="chat-wrapper"] [class*="count"]',
  },
  detailImages: 'img[class*="note-slider-img"]',

  // Login-state detection.
  // XHS shows search results only to logged-in users. When anonymous, the page
  // returns 200 (no redirect) but renders an inline login modal with the body
  // text "登录后查看搜索结果". We detect by both URL and body text.
  loginIndicators: {
    loginRequiredOverlay: '[class*="login-container"], [class*="login-mask"]',
    redirectHostname: 'passport.xiaohongshu.com',
    loginRequiredText: '登录后查看搜索结果',
  },
};
