
const viewHome = document.querySelector('#view-home');
const viewSetup = document.querySelector('#view-setup');
const viewChat = document.querySelector('#view-chat');
const viewSettings = document.querySelector('#view-settings');
const viewSkills = document.querySelector('#view-skills');
const viewMemory = document.querySelector('#view-memory');
const fullNav = document.querySelector('#full-nav');
const fullChats = document.querySelector('#full-chats');
const navToggleBtn = document.querySelector('#nav-toggle');
const navExpandBtn = document.querySelector('#nav-expand');
const homeForm = document.querySelector('#search-form');
const queryEl = document.querySelector('#query');
const queryGhostEl = document.querySelector('#query-ghost');
const suggestEl = document.querySelector('#search-suggest');
const searchAreaEl = document.querySelector('.search-area');
const tabHintEl = document.querySelector('.tab-hint');
const searchModeBtn = document.querySelector('#search-mode');
const askModeBtn = document.querySelector('#ask-mode');
const homeStatusEl = document.querySelector('#home-status');
const chatCardsEl = document.querySelector('#chat-cards');
const chatsEmptyEl = document.querySelector('#chats-empty');
const setupSlot = document.querySelector('#setup-slot');
const settingsSlot = document.querySelector('#settings-slot');
const configEl = document.querySelector('#config');
const statusEl = document.querySelector('#status');
const bannerEl = document.querySelector('#banner');
const runtimeErrorEl = document.querySelector('#runtime-error');
const configErrorEl = document.querySelector('#config-error');
const portEl = document.querySelector('#port');
const sessionBtn = document.querySelector('#session-btn');
const sessionLabel = document.querySelector('#session-label');
const newSessionBtn = document.querySelector('#new-session');
const navNewChatBtn = document.querySelector('#nav-new-chat');
const skillsListEl = document.querySelector('#skills-list');
const newSkillToggle = document.querySelector('#new-skill-toggle');
const newSkillForm = document.querySelector('#new-skill-form');
const skillNameEl = document.querySelector('#skill-name');
const skillDescriptionEl = document.querySelector('#skill-description');
const skillEmptyEl = document.querySelector('#skill-empty');
const skillEditorEl = document.querySelector('#skill-editor');
const skillTextEl = document.querySelector('#skill-text');
const saveSkillBtn = document.querySelector('#save-skill');
const skillsErrorEl = document.querySelector('#skills-error');
const memoryTextEl = document.querySelector('#memory-text');
const saveMemoryBtn = document.querySelector('#save-memory');
const memoryErrorEl = document.querySelector('#memory-error');
const memoryFilesEl = document.querySelector('#memory-files');
const memoryHistoryEl = document.querySelector('#memory-history');
const memoryFileLabelEl = document.querySelector('#memory-file-label');
const siteChipWrap = document.querySelector('#site-chip-wrap');
const tabsEl = document.querySelector('#tabs');
const messagesEl = document.querySelector('#messages');
const promptEl = document.querySelector('#prompt');
const composerEl = document.querySelector('.composer');
const fileInput = document.querySelector('#file-input');
const attachmentPreviews = document.querySelector('#attachment-previews');
const pendingChip = document.querySelector('#pending-chip');
const pendingText = document.querySelector('#pending-text');
const pendingAction = document.querySelector('#pending-action');
const pendingTrash = document.querySelector('#pending-trash');
const sendEl = document.querySelector('#send');
const sendMenuToggle = document.querySelector('#send-menu-toggle');
const sendMenu = document.querySelector('#send-menu');
const composerPlus = document.querySelector('#composer-plus');
const chatFooter = document.querySelector('#chat-footer');
const modelBtn = document.querySelector('#model-btn');
const modelLabel = document.querySelector('#model-label');
const settingsModelBtn = document.querySelector('#settings-model-btn');
const settingsModelLabel = document.querySelector('#settings-model-label');
const titleModelBtn = document.querySelector('#title-model-btn');
const titleModelLabel = document.querySelector('#title-model-label');
const thinkingBtn = document.querySelector('#thinking-btn');
const thinkingLabel = document.querySelector('#thinking-label');
const popoverEl = document.querySelector('#popover');
const popoverFilter = document.querySelector('#popover-filter');
const popoverList = document.querySelector('#popover-list');
const sourceCard = document.querySelector('#source-card');
const sourceCardPrev = document.querySelector('#source-card-prev');
const sourceCardNext = document.querySelector('#source-card-next');
const sourceCardLink = document.querySelector('#source-card-link');
const sourceCardFavicon = document.querySelector('#source-card-favicon');
const sourceCardTitle = document.querySelector('#source-card-title');
const sourceCardSnippet = document.querySelector('#source-card-snippet');

const ICONS = {
  inspect: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="currentColor" d="M11 3h2v3h-2zM11 18h2v3h-2zM3 11h3v2H3zM18 11h3v2h-3z"/></svg>',
  code: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m8.2 7.2-4.7 4.8 4.7 4.8 1.4-1.4L6.3 12l3.3-3.4-1.4-1.4zm7.6 0-1.4 1.4 3.3 3.4-3.3 3.4 1.4 1.4 4.7-4.8-4.7-4.8z"/></svg>',
  read: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 6c5 0 8.8 4.2 9.8 6-1 1.8-4.8 6-9.8 6s-8.8-4.2-9.8-6C3.2 10.2 7 6 12 6zm0 3.5A2.5 2.5 0 1 0 12 14.5 2.5 2.5 0 0 0 12 9.5z"/></svg>',
  fetch: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h8l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm7 1.5V9h4.5L14 4.5z"/></svg>',
  memory: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8.5 5a3.5 3.5 0 0 1 3.3 2.4A3.5 3.5 0 0 1 19 10.5c0 .5-.1 1-.3 1.4A3.5 3.5 0 0 1 16.5 19h-9A3.5 3.5 0 0 1 5 12.7 3.5 3.5 0 0 1 8.5 5z"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm6.7 9.3 4.3 4.3-1.4 1.4-4.3-4.3 1.4-1.4z"/></svg>',
  page: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h8l5 5v13H7V3zm7 1.5V9h4.5L14 4.5z"/></svg>',
  caret: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 10l4 4 4-4H8z"/></svg>',
};

const stopEl = document.querySelector('#stop');
const mentionMenuEl = document.querySelector('#mention-menu');
const mentionChipsEl = document.querySelector('#mention-chips');
const chatsFilterEl = document.querySelector('#chats-filter');
const archivedListEl = document.querySelector('#archived-list');
const archivedToggleEl = document.querySelector('#archived-chats');

export {
  viewHome, viewSetup, viewChat, viewSettings, viewSkills, viewMemory,
  fullNav, fullChats, navToggleBtn, navExpandBtn,
  homeForm, queryEl, queryGhostEl, suggestEl, searchAreaEl, tabHintEl, searchModeBtn, askModeBtn, homeStatusEl, chatCardsEl, chatsEmptyEl,
  setupSlot, settingsSlot, configEl, statusEl, bannerEl, runtimeErrorEl, configErrorEl, portEl,
  sessionBtn, sessionLabel, newSessionBtn, navNewChatBtn,
  skillsListEl, newSkillToggle, newSkillForm, skillNameEl, skillDescriptionEl, skillEmptyEl, skillEditorEl, skillTextEl, saveSkillBtn, skillsErrorEl,
  memoryTextEl, saveMemoryBtn, memoryErrorEl, memoryFilesEl, memoryHistoryEl, memoryFileLabelEl,
  siteChipWrap, tabsEl, messagesEl, promptEl, composerEl, fileInput, attachmentPreviews,
  pendingChip, pendingText, pendingAction, pendingTrash,
  sendEl, sendMenuToggle, sendMenu, composerPlus, chatFooter,
  modelBtn, modelLabel, settingsModelBtn, settingsModelLabel, titleModelBtn, titleModelLabel, thinkingBtn, thinkingLabel,
  popoverEl, popoverFilter, popoverList,
  sourceCard, sourceCardPrev, sourceCardNext, sourceCardLink, sourceCardFavicon, sourceCardTitle, sourceCardSnippet,
  ICONS,
  stopEl, mentionMenuEl, mentionChipsEl, chatsFilterEl, archivedListEl, archivedToggleEl,
};
