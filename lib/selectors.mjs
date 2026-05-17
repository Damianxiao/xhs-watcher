// XHS DOM selectors — KEEP IN ONE PLACE.
// These need to be verified manually by opening the search page and inspecting
// the rendered DOM. Update as XHS frontend changes.

export const XHS = {
  // Search result feed (set of note cards)
  feedContainer: '.feeds-container, [class*="search-result"]',
  noteCard: 'section.note-item, [class*="note-item"]',

  // Within a card: extract these. Selectors verified against live DOM
  // 2026-05-17. Card sample:
  //   <section class="note-item">
  //     <a href="/explore/<note_id>" style="display:none"></a>     ← cardLink
  //     <a class="cover mask ld" href="/search_result/...">         ← skip (cover)
  //     <a class="title" href="...">                                ← cardTitle
  //       <span>...title text...</span>
  //     </a>
  //     <a class="author" href="/user/...">                          ← cardAuthor (text "<name>\n<time>")
  //     <div class="name-time-wrapper">
  //       <div class="time">5天前</div>                              ← cardRelativeTime
  //     </div>
  //     <span class="like-wrapper">
  //       <span class="count">359</span>                             ← cardLikes
  //     </span>
  //   </section>
  cardLink: 'a[href*="/explore/"]',
  cardTitle: 'a.title',
  cardAuthor: 'a.author',
  cardRelativeTime: '.time',
  cardLikes: '.like-wrapper .count',

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
