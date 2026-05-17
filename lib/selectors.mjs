// XHS DOM selectors — KEEP IN ONE PLACE.
// These need to be verified manually by opening the search page and inspecting
// the rendered DOM. Update as XHS frontend changes.

export const XHS = {
  // Search result feed (set of note cards)
  feedContainer: '.feeds-container, [class*="search-result"]',
  noteCard: 'section.note-item, [class*="note-item"]',

  // Within a card: extract these. Selectors verified against live DOM 2026-05-17.
  //   <section class="note-item">
  //     <a href="/explore/<note_id>" style="display:none"></a>        ← bare URL (NO xsec_token; direct nav 404s)
  //     <a class="cover mask ld" href="/search_result/<id>?xsec_token=...&xsec_source="> ← tokenized
  //     <a class="title" href="/search_result/<id>?xsec_token=...">    ← tokenized + has title text
  //     <a class="author" href="/user/..."> ... </a>
  //     <div class="time">5天前</div>
  //     <span class="like-wrapper"><span class="count">359</span></span>
  //   </section>
  //
  // cardLink MUST be the tokenized variant (a.title) — the bare /explore link
  // returns "当前笔记暂时无法浏览" (404) when navigated to directly.
  cardLink: 'a.title',
  cardTitle: 'a.title',
  cardAuthor: 'a.author',
  cardRelativeTime: '.time',
  cardLikes: '.like-wrapper .count',

  // Detail page (after clicking the tokenized URL). Verified live 2026-05-17.
  detailContent: '#detail-desc',
  detailTitle: '#noteContainer .title',
  detailTags: '.tag',
  detailMetrics: {
    likes: '.like-wrapper .count',
    collects: '.collect-wrapper .count',
    comments: '.chat-wrapper .count',
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
