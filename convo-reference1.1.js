// TypingMind Conversation Reference Extension
// Version: 1.0.0
// Description: Adds a button to reference previous conversations in TypingMind
// Author: Original by basfenix
// License: MIT
// Usage: Add this script URL to TypingMind's custom extensions


(() => {
  // ----------------------------------------
  // Configuration
  // ----------------------------------------
  const CONFIG = {
    version: '1.0.0',
    debug: true,                     // Enable console logging
    initialCheckDelay: 2000,         // Delay before first button injection attempt
    buttonRetryDelay: 1000,          // Milliseconds to wait between retries
    maxRetryAttempts: 5,             // Maximum number of retries for button injection
    buttonTooltip: 'Reference previous conversations',
    modalTitle: 'Select a conversation to reference',
    searchPlaceholder: 'Search conversations...',
    noResultsText: 'No matching conversations found.',
    cancelButtonText: 'Cancel'
  };

  // ----------------------------------------
  // State Management
  // ----------------------------------------
  let buttonAdded = false;
  let observerActive = false;
  let checkInterval = null;
  let attemptCount = 0;
  let lastNavTime = 0;

  // Keep references to original History methods
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  // ----------------------------------------
  // Utility Functions
  // ----------------------------------------
  function log(...args) {
    if (CONFIG.debug) console.log('[ConvoRef]', ...args);
  }

  // Helper function for text insertion
  function insertTextIntoInput(textarea, textToInsert) {
    log("Attempting text insertion...");
    
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const currentValue = textarea.value;
    const newValue = currentValue.substring(0, selectionStart) + textToInsert + currentValue.substring(selectionEnd);
    
    textarea.focus();
    
    try {
      textarea.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      
      try {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        nativeInputValueSetter.call(textarea, newValue);
      } catch (e) {
        log("Native setter failed, falling back to direct assignment");
        textarea.value = newValue;
      }
      
      textarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("compositionend", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
      
      textarea.selectionStart = selectionStart + textToInsert.length;
      textarea.selectionEnd = textarea.selectionStart;
      
      log("Insertion complete");
      return true;
    } catch (e) {
      log("Insertion failed:", e);
      return false;
    }
  }

  // ----------------------------------------
  // Button & UI Management
  // ----------------------------------------
  /**
   * Finds the chat input action bar by its unique data-element-id.
   * @returns {HTMLElement|null} The chat input action bar element, or null if not found.
   */
  function findChatActionBar() {
    return document.querySelector('[data-element-id="chat-input-actions"]');
  }

  /**
   * Adds the reference button to the chat input action bar if present.
   * Ensures the button is only injected on chat pages and not elsewhere.
   * Removes the button if the action bar is not present.
   * @returns {boolean} True if the button was added, false otherwise.
   */
  function addReferenceButton() {
    try {
      // Remove existing button to avoid duplicates
      const existingButton = document.getElementById('tm-reference-chat-button-container');
      if (existingButton) {
        log("Removing existing button");
        existingButton.remove();
      }

      const actionBar = findChatActionBar();
      if (!actionBar) {
        log("Chat input actions bar not found. Button will not be injected.");
        // If the button exists but the action bar is gone, remove the button
        return false;
      }

      // Find the left side of the action bar
      const leftSide = actionBar.querySelector('.flex.items-center.justify-start');
      if (!leftSide) {
        log("Could not find left side of action bar. Button will not be injected.");
        return false;
      }

      log("Found chat input action bar, injecting button");

      // Create button container
      const refButtonContainer = document.createElement('div');
      refButtonContainer.id = 'tm-reference-chat-button-container';
      refButtonContainer.innerHTML = '<button id="reference-chat-button" class="focus-visible:outline-blue-600 w-9 h-9 rounded-lg justify-center items-center gap-1.5 inline-flex text-slate-900 hover:bg-slate-900/20 active:bg-slate-900/25 disabled:text-neutral-400 dark:text-white dark:hover:bg-white/20 dark:active:bg-white/25 dark:disabled:text-neutral-500" data-tooltip-content="' + CONFIG.buttonTooltip + '" data-tooltip-id="global"><svg class="w-5 h-5" width="18px" height="18px" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><path d="M15,2H3C2.4,2,2,2.4,2,3v10c0,0.6,0.4,1,1,1h2v2.5c0,0.3,0.3,0.5,0.6,0.4l4.6-2.9H15c0.6,0,1-0.4,1-1V3C16,2.4,15.6,2,15,2z" fill="none" stroke="currentColor" stroke-width="1.5"></path><path d="M5.5,6.5h7" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"></path><path d="M5.5,9.5h4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"></path></g></svg></button>';

      // Insert button in the left side
      leftSide.prepend(refButtonContainer);
      log("Button added");

      // Add click handler
      refButtonContainer.addEventListener('click', (event) => {
        if (event.target.closest('#reference-chat-button')) {
          handleButtonClick();
        }
      });

      buttonAdded = true;
      return true;
    } catch (error) {
      log("Error adding button:", error);
      return false;
    }
  }

  /**
   * Removes the reference button from the DOM if it exists.
   */
  function removeReferenceButton() {
    const existingButton = document.getElementById('tm-reference-chat-button-container');
    if (existingButton) {
      log("Removing reference button due to chat bar disappearance or navigation.");
      existingButton.remove();
      buttonAdded = false;
    }
  }

  // ----------------------------------------
  // Chat Selection Modal
  // ----------------------------------------
  async function handleButtonClick() {
    log("Reference button clicked");
    try {
      const chats = await getChatsFromIndexedDB();
      if (!chats || chats.length === 0) {
        alert("No previous chats found.");
        return;
      }
      
      // Sort chats by update time, newest first
      chats.sort((a, b) => (new Date(b.updatedAt || b.createdAt || 0)) - (new Date(a.updatedAt || a.createdAt || 0)));
      log(`Retrieved ${chats.length} chats`);
      
      // Create modal
      const modal = document.createElement('div');
      modal.id = 'tm-reference-chat-modal'; 
      modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 10000; display: flex; justify-content: center; align-items: center;';
      
      // Add keyboard handling
      modal.tabIndex = -1;
      modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const modalToRemove = document.getElementById('tm-reference-chat-modal');
          if (modalToRemove) modalToRemove.remove();
        }
      });
      
      // Create modal content
      const modalContent = document.createElement('div');
      modalContent.style.cssText = 'background: white; padding: 20px; border-radius: 8px; width: 600px; height: 600px; display: grid; grid-template-rows: auto auto 1fr auto; gap: 16px; overflow: hidden; color: black;';
      
      const header = document.createElement('div');
      header.innerHTML = '<h2 style="margin: 0; color: black; font-size: 18px;">' + CONFIG.modalTitle + '</h2>';
      
      const searchBox = document.createElement('div');
      searchBox.innerHTML = '<input type="text" id="tm-reference-search-input" placeholder="' + CONFIG.searchPlaceholder + '" style="width: 100%; padding: 8px 12px; border: 1px solid #cbd5e0; border-radius: 6px;">';
      
      const chatList = document.createElement('div');
      chatList.id = 'tm-reference-chat-list';
      chatList.style.cssText = 'overflow-y: auto; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 0; margin: 0;';

      // Function to populate chat list
      function populateChatList(filteredChats) {
        chatList.innerHTML = ''; 
        if (!filteredChats || filteredChats.length === 0) { 
          chatList.innerHTML = '<p style="text-align: center; padding: 20px; color: #718096;">' + CONFIG.noResultsText + '</p>'; 
          return; 
        }
        
        filteredChats.forEach(chat => {
          const chatItemContainer = document.createElement('div');
          const title = chat.chatTitle || 'Untitled Conversation';
          const date = chat.updatedAt ? new Date(chat.updatedAt).toLocaleString() : chat.createdAt ? new Date(chat.createdAt).toLocaleString() : 'Unknown date';
          const model = chat.model || '';
          const messageCount = chat.messages ? chat.messages.length : 0;
          
          chatItemContainer.innerHTML = '<div class="tm-reference-chat-item" style="padding: 12px; margin: 0; border-bottom: 1px solid #e2e8f0; cursor: pointer; transition: background-color 0.2s; color: black;"><div style="display: flex; justify-content: space-between; align-items: center;"><strong style="font-size: 15px; margin-right: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + title + '</strong><span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 12px; white-space: nowrap;">' + messageCount + ' messages</span></div><div style="margin-top: 4px; font-size: 13px; color: #4a5568; display: flex; justify-content: space-between;"><span>' + date + '</span><span style="color: #718096; font-style: italic; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + model + '</span></div></div>';
          
          // Store chat data
          chatItemContainer._chatData = chat;
          
          // Add hover effects
          const chatDiv = chatItemContainer.querySelector('.tm-reference-chat-item');
          chatDiv.addEventListener('mouseover', () => chatDiv.style.backgroundColor = '#f0f4f8');
          chatDiv.addEventListener('mouseout', () => chatDiv.style.backgroundColor = '');
          
          chatList.appendChild(chatItemContainer);
        });
      }
      
      // Initial population
      populateChatList(chats);
      
      // Search functionality
      const searchInput = searchBox.querySelector('#tm-reference-search-input');
      searchInput.addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase();
        const filtered = chats.filter(chat => (chat.chatTitle || 'Untitled Conversation').toLowerCase().includes(searchTerm));
        populateChatList(filtered);
      });
      
      // Handle chat selection
      chatList.addEventListener('click', function(event) {
        const clickedItemDiv = event.target.closest('.tm-reference-chat-item');
        if (!clickedItemDiv) return; 
        
        const chatItemContainer = clickedItemDiv.parentNode;
        const chatData = chatItemContainer._chatData; 
        if (!chatData) {
          log("Could not find chat data for clicked item");
          return;
        }
        
        log("Selected chat:", chatData.chatTitle || 'Untitled');
        
        // Format conversation text
        let formattedText = '';
        if (chatData.messages && Array.isArray(chatData.messages)) {
          chatData.messages.forEach(msg => {
            let role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : null;
            let contentText = '';
            if (msg.content) {
              if (typeof msg.content === 'string') { 
                contentText = msg.content;
              } else if (Array.isArray(msg.content)) { 
                contentText = msg.content.filter(part => part && part.type === 'text' && part.text).map(part => part.text).join('\n');
              } else if (typeof msg.content === 'object' && msg.content.text) { 
                contentText = msg.content.text;
              }
            }
            if (role && contentText && contentText.trim()) {
              formattedText += role + ': ' + contentText.trim() + '\n\n';
            }
          });
        }
        
        // Create reference text
        const referenceHeader = '\n\n--- Start Reference ---\nConversation: "' + (chatData.chatTitle || 'Untitled') + '"\nLast Updated: ' + (chatData.updatedAt ? new Date(chatData.updatedAt).toLocaleString() : 'N/A') + '\n\n';
        const referenceFooter = '--- End Reference ---\n';
        const fullTextToInsert = referenceHeader + formattedText + referenceFooter;

        // Find the textarea
        const textarea = document.getElementById('chat-input-textbox') || 
                         document.querySelector('[data-element-id="chat-input-textbox"]') ||
                         document.querySelector('textarea'); 
                          
        if (!textarea) {
          alert("Error: Could not find the chat input textarea.");
          log("Textarea not found for insertion");
          return;
        }
        
        // Insert text
        const success = insertTextIntoInput(textarea, fullTextToInsert);
        if (!success) {
          log("Text insertion failed");
          alert("Could not insert text. Please try copying it manually.");
        }
        
        // Close modal
        const modalToRemove = document.getElementById('tm-reference-chat-modal');
        if (modalToRemove) modalToRemove.remove();
      });
      
      // Add close button
      const closeButton = document.createElement('button');
      closeButton.innerHTML = CONFIG.cancelButtonText;
      closeButton.style.cssText = 'padding: 8px 16px; border-radius: 6px; background: #e53e3e; color: white; border: none; cursor: pointer; font-size: 14px; width: fit-content; margin-left: auto;';
      closeButton.onclick = () => { 
        const modalToRemove = document.getElementById('tm-reference-chat-modal');
        if (modalToRemove) modalToRemove.remove();
      };
      
      // Assemble modal
      modalContent.appendChild(header);
      modalContent.appendChild(searchBox);
      modalContent.appendChild(chatList);
      modalContent.appendChild(closeButton);
      modal.appendChild(modalContent);
      document.body.appendChild(modal);
      
      // Focus management
      setTimeout(() => {
        searchInput.focus();
        modal.focus();
      }, 100);
      
    } catch (error) {
      log("Error in handleButtonClick:", error);
      alert("Error opening reference list: " + error.message);
    }
  }

  // ----------------------------------------
  // IndexedDB Access
  // ----------------------------------------
  async function getChatsFromIndexedDB() {
    try {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('keyval-store');
        request.onerror = (e) => reject(new Error('Failed to open keyval-store database: ' + e.target.error));
        request.onsuccess = () => resolve(request.result);
      });
      
      log("IndexedDB opened successfully");
      
      const transaction = db.transaction(['keyval'], 'readonly');
      const store = transaction.objectStore('keyval');
      
      const allEntries = await new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onerror = (e) => reject(new Error('Failed to get entries from store: ' + e.target.error));
        request.onsuccess = () => resolve(request.result);
      });
      
      log(`Retrieved ${allEntries.length} entries from store`);
      
      // Filter for chat objects
      const chats = allEntries.filter(entry => 
        entry && 
        typeof entry === 'object' && 
        ((entry.chatTitle !== undefined && entry.messages !== undefined) || 
         (entry.id && entry.messages && Array.isArray(entry.messages)))
      );
      
      log(`Filtered down to ${chats.length} chat entries`);
      db.close();
      return chats;
    } catch (error) {
      log("Error accessing IndexedDB:", error);
      throw error;
    }
  }

  // ----------------------------------------
  // UI Observation & Navigation Handling
  // ----------------------------------------
  /**
   * Sets up a MutationObserver to monitor for the presence of the chat input action bar.
   * Injects or removes the reference button as appropriate.
   */
  function setupObserver() {
    if (observerActive) return;
    try {
      const observer = new MutationObserver((mutations) => {
        let shouldCheck = false;
        let shouldRemove = false;

        for (const mutation of mutations) {
          if (mutation.type !== 'childList') continue;
          // Check for addition of chat input bar
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue; // elements only
            if (
              (node.getAttribute && node.getAttribute('data-element-id') === 'chat-input-actions') ||
              (node.querySelector && node.querySelector('[data-element-id="chat-input-actions"]'))
            ) {
              shouldCheck = true;
              break;
            }
          }
          // Check for removal of chat input bar
          for (const node of mutation.removedNodes) {
            if (node.nodeType !== 1) continue;
            if (
              (node.getAttribute && node.getAttribute('data-element-id') === 'chat-input-actions') ||
              (node.querySelector && node.querySelector('[data-element-id="chat-input-actions"]'))
            ) {
              shouldRemove = true;
              break;
            }
          }
          if (shouldCheck || shouldRemove) break;
        }

        if (shouldCheck) {
          clearTimeout(window.convoRefDebounce);
          window.convoRefDebounce = setTimeout(() => {
            log('Chat UI changed, checking for button injection');
            addReferenceButton();
          }, 500);
        }
        if (shouldRemove) {
          clearTimeout(window.convoRefDebounce);
          window.convoRefDebounce = setTimeout(() => {
            log('Chat UI changed, checking for button removal');
            if (!findChatActionBar()) {
              removeReferenceButton();
            }
          }, 500);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      observerActive = true;
      log('DOM Observer activated');
      window.convoRefObserver = observer;
    } catch (err) {
      log('Error setting up observer:', err);
    }
  }

  /**
   * Handles navigation events and ensures the button is only present on chat pages.
   * @param {string} eventLabel - Label for the navigation event.
   */
  function handleNavigation(eventLabel) {
    const now = Date.now();
    if (now - lastNavTime < 500) {
      log(`Ignoring rapid navigation event (${eventLabel})`);
      return;
    }
    lastNavTime = now;

    log(`Navigation detected: ${eventLabel}`);
    buttonAdded = false; // Need to re-add button

    setTimeout(() => {
      if (findChatActionBar()) {
        if (addReferenceButton()) {
          log('Button added after navigation');
        }
      } else {
        removeReferenceButton();
      }
    }, 1500);
  }

  // Override history methods
  history.pushState = function(...args) {
    originalPushState.apply(this, args);
    handleNavigation('pushState');
  };

  history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    handleNavigation('replaceState');
  };

  // Listen for popstate
  window.addEventListener('popstate', () => {
    handleNavigation('popstate');
  });

  // Listen for tab visibility
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      log('Tab became visible');
      handleNavigation('visibilityChange');
    }
  });

  // ----------------------------------------
  // Cleanup
  // ----------------------------------------
  function cleanup() {
    if (window.convoRefObserver) {
      window.convoRefObserver.disconnect();
      observerActive = false;
    }
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    if (window.convoRefDebounce) {
      clearTimeout(window.convoRefDebounce);
    }

    // Restore original history methods
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;

    log('Script cleaned up');
  }

  // ----------------------------------------
  // Initialization
  // ----------------------------------------
  log(`Conversation Reference Extension v${CONFIG.version} initializing...`);

  // Delay first check to ensure UI has initialized
  setTimeout(() => {
    setupObserver();
    setTimeout(() => {
      if (addReferenceButton()) {
        log('Button added on initial check');
      } else {
        log('Button not found initially, will check again on UI changes');
        // Start retry checks
        handleNavigation('initial');
      }
    }, 1000);
  }, CONFIG.initialCheckDelay);

  // Expose global controls for debugging
  window.convoRef = {
    addButton: addReferenceButton,
    cleanup: cleanup,
    version: CONFIG.version
  };
})();