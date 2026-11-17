import { createService } from './service.js';
const dispatch = createService({ storage: chrome.storage.local, tabs: chrome.tabs });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  dispatch(message, sender).then(sendResponse);
  return true;
});
