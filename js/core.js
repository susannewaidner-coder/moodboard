'use strict';


      /* ========================================================================
         1. KONFIGURATION & STATE
         ======================================================================== */
      const APP_VERSION = 'v1.0.24';
      const LS_KEYS = {
        clientId: 'mb_oauth_client_id',
        rootName: 'mb_root_folder_name',
        scope: 'mb_oauth_scope',
        theme: 'mb_theme_mode',
        pendingSaves: 'mb_pending_board_saves',
        demoMode: 'mb_demo_mode',
        demoData: 'mb_demo_data_v1',
        geminiKey: 'mb_gemini_api_key',
        lastFolderId: 'mb_last_folder_id',
        lastView: 'mb_last_view',
        lastQuickView: 'mb_last_quick_view'
      };

      const CLIENT_SESSION_ID = 'sess-' + Math.random().toString(36).slice(2, 10);

      const state = {
        mode: 'unauthenticated', // 'unauthenticated' | 'drive' | 'demo'
        accessToken: null,
        tokenExpiresAt: 0,
        tokenClient: null,
        rootFolderId: null,
        folders: [],             // Flache Liste: { id, name, parents: [] }
        expandedFolders: new Set(),
        activeFolderId: null,
        quickView: null,         // null | 'all' | 'shopping' | 'todos'
        activeView: 'gallery',   // 'gallery' | 'home' | 'canvas' | 'planning'
        galleryMode: 'grid',     // 'grid' | 'list'
        searchQuery: '',
        folderContents: {},      // folderId -> { board, boardFileId, modifiedTime, driveFiles: [] }
        objectUrls: new Map(),   // driveFileId -> blobObjectUrl
        dirtyFolders: new Set(),
        savingFolders: new Set(),
        resaveFolders: new Set(),
        saveTimers: {},
        selectedGalleryIds: new Set(),
        gallerySelectMode: false,
        editingItem: null,
        pendingConflict: null,
        canvasZoom: 1,
        canvasPanX: 0,
        canvasPanY: 0,
        canvasLocked: window.innerWidth < 640,
        canvasFullscreen: false,
        canvasFitMode: 'cover', // 'cover' | 'contain'
        canvasBg: 'default',    // 'default' | 'white' | 'dark'
        canvasShowGrid: true,
        selectedCanvasIds: new Set(),
        homeEditMode: false,
        homeActiveZoneId: null,
        eyedropperPickedHex: '#C59B6D',
        canvasSplitOpen: false,
        shopFilter: 'all',
        todoFilter: 'Alle',
        globalTags: ['Basteln', 'Material', 'Deko', 'Inspiration', 'Weihnachten', 'Dekoobjekt', 'Verpackung', 'Möbel', 'Tischdeko', 'Trockenblume', 'Streudeko', 'Karte', 'Ostern', 'Christbaum', 'Vase', 'Kuchen', 'Rezept', 'Winter', 'Dekobasis', 'Kerzenhalter', 'Outdoor', 'Kerze', 'Plätzchen', 'Sommer', 'Frühling', 'Herbst', 'Pflanzen'],
        tagsFileId: null,
        globalLocations: ['Kiste 1, Arbeitszimmer', 'Regal links, Keller', 'Wohnzimmer-Schrank', 'Dachboden'],
        locationsFileId: null,
        inventoryRootId: null,
        activeTagFilters: new Set(),
        activeLocationFilters: new Set(),
        editingItemTags: new Set(),
        editingItemLocation: '',
        gallerySort: 'newest',
        tagDropdownOpen: false,
        locationDropdownOpen: false,
        inventoryPickerSelected: new Set(),
        inventoryPickerFolderId: null
      };

      /* ========================================================================
         2. HILFSFUNKTIONEN
         ======================================================================== */
      function uid(prefix = 'id') {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      }

      function escapeHtml(str) {
        return String(str || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function createDefaultBoard(folderName = 'Projekt') {
        return {
          version: 1,
          folderType: 'project',
          projectHome: {
            enabled: true,
            eyebrow: 'Projekt-Konzept',
            title: folderName,
            lead: '',
            swatches: [],
            zoneRules: [],
            tips: []
          },
          budget: { limit: 0, currency: 'EUR', includeSubfolders: true },
          items: [],
          todos: []
        };
      }

      function getSettings() {
        return {
          clientId: localStorage.getItem(LS_KEYS.clientId) || '',
          rootName: localStorage.getItem(LS_KEYS.rootName) || 'Moodboards',
          scope: localStorage.getItem(LS_KEYS.scope) || 'https://www.googleapis.com/auth/drive.file',
          geminiKey: localStorage.getItem(LS_KEYS.geminiKey) || ''
        };
      }

      function showSyncStatus(text, show = true) {
        const el = document.getElementById('toastBox');
        if (!el) return;
        if (show && text) {
          el.textContent = text;
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      }

      function revokeAllObjectUrls() {
        for (const url of state.objectUrls.values()) {
          URL.revokeObjectURL(url);
        }
        state.objectUrls.clear();
      }

      function showUiDialog({ title = 'Hinweis', message = '', fields = [], showCancel = false, okText = 'OK' }) {
        return new Promise((resolve) => {
          const modal = document.getElementById('uiDialogModal');
          const titleEl = document.getElementById('uiDialogTitle');
          const msgEl = document.getElementById('uiDialogMessage');
          const fieldsEl = document.getElementById('uiDialogFields');
          const cancelBtn = document.getElementById('uiDialogCancelBtn');
          const okBtn = document.getElementById('uiDialogOkBtn');
          const closeBtn = document.getElementById('uiDialogCloseBtn');

          titleEl.textContent = title;
          msgEl.textContent = message;
          msgEl.style.display = message ? 'block' : 'none';
          cancelBtn.style.display = showCancel ? 'inline-flex' : 'none';
          okBtn.textContent = okText;

          fieldsEl.innerHTML = fields.map((f, idx) => `
            <div class="form-group">
              <label class="form-label" for="uiDlgField_${idx}">${escapeHtml(f.label || '')}</label>
              <input id="uiDlgField_${idx}" class="form-control" type="${f.type || 'text'}" value="${escapeHtml(f.value ?? '')}" placeholder="${escapeHtml(f.placeholder || '')}" />
            </div>
          `).join('');

          function cleanup(result) {
            modal.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            closeBtn.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKey);
            resolve(result);
          }

          function onOk() {
            if (fields.length > 0) {
              const values = {};
              for (let i = 0; i < fields.length; i++) {
                const inp = document.getElementById(`uiDlgField_${i}`);
                const val = inp.value;
                if (fields[i].required && !val.trim()) {
                  inp.focus();
                  return;
                }
                values[fields[i].key] = val;
              }
              cleanup(values);
            } else {
              cleanup(true);
            }
          }

          function onCancel() {
            cleanup(fields.length > 0 ? null : false);
          }

          function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            else if (e.key === 'Enter' && document.activeElement && document.activeElement.tagName !== 'BUTTON') {
              e.preventDefault();
              onOk();
            }
          }

          okBtn.addEventListener('click', onOk);
          cancelBtn.addEventListener('click', onCancel);
          closeBtn.addEventListener('click', onCancel);
          document.addEventListener('keydown', onKey);
          modal.classList.remove('hidden');

          const firstInput = document.getElementById('uiDlgField_0');
          if (firstInput) setTimeout(() => { firstInput.focus(); firstInput.select(); }, 30);
          else setTimeout(() => okBtn.focus(), 30);
        });
      }

      function uiAlert(message, title = 'Hinweis') {
        return showUiDialog({ title, message, showCancel: false, okText: 'OK' });
      }

      function uiConfirm(message, title = 'Bestätigung', okText = 'OK') {
        return showUiDialog({ title, message, showCancel: true, okText });
      }

      function uiPromptForm(title, fields, message = '') {
        return showUiDialog({ title, message, fields, showCancel: true, okText: 'Speichern' });
      }

      /* ========================================================================
         3. DEMO-MODUS ADAPTER (LOKAL OHNE GOOGLE LOGIN TESTBAR)
         ======================================================================== */
      const DemoAdapter = {
        load() {
          const raw = localStorage.getItem(LS_KEYS.demoData);
          if (raw) return JSON.parse(raw);
          const rootId = 'demo-root';
          const f1 = 'demo-xmas';
          const f2 = 'demo-table';
          const initial = {
            rootFolderId: rootId,
            folders: [
              { id: f1, name: 'Weihnachten 2026', parents: [rootId] },
              { id: f2, name: 'Esstisch & Tafel', parents: [f1] }
            ],
            boards: {
              [f1]: {
                ...createDefaultBoard('Weihnachten 2026'),
                items: [
                  {
                    id: 'demo-item-1',
                    type: 'bookmark',
                    url: 'https://example.com/skandi-kerzen',
                    previewImageUrl: '',
                    title: 'Beispiel-Bookmark: Stabkerzen Salbei',
                    note: 'Demo-Eintrag – füge oben Bilder oder eigene Bookmarks hinzu.',
                    tags: ['salbei', 'kerze', 'weihnachten']
                  }
                ]
              },
              [f2]: createDefaultBoard('Esstisch & Tafel')
            }
          };
          localStorage.setItem(LS_KEYS.demoData, JSON.stringify(initial));
          return initial;
        },
        save(data) {
          localStorage.setItem(LS_KEYS.demoData, JSON.stringify(data));
        }
      };

      /* ========================================================================
         4. GOOGLE OAUTH & DRIVE REST API V3 ADAPTER
         ======================================================================== */
      const DriveAdapter = {
        async apiFetch(url, options = {}) {
          if (!state.accessToken) {
            const err = new Error('Kein Access Token');
            err.status = 401;
            throw err;
          }
          const headers = new Headers(options.headers || {});
          headers.set('Authorization', `Bearer ${state.accessToken}`);
          const res = await fetch(url, { ...options, headers });
          if (res.status === 401) {
            handleTokenExpired();
            const err = new Error('Sitzung abgelaufen (401)');
            err.status = 401;
            throw err;
          }
          if (!res.ok) {
            const txt = await res.text();
            const err = new Error(`Drive API Fehler (${res.status}): ${txt}`);
            err.status = res.status;
            throw err;
          }
          return res;
        },

        async ensureRootFolder(rootName) {
          const q = encodeURIComponent(`name='${rootName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents`);
          const res = await this.apiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
          const data = await res.json();
          if (data.files && data.files.length > 0) return data.files[0].id;
          const created = await this.createFolder('root', rootName);
          return created.id;
        },

        async createFolder(parentId, name) {
          const res = await this.apiFetch('https://www.googleapis.com/drive/v3/files?fields=id,name,parents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [parentId]
            })
          });
          return res.json();
        },

        async renameFile(fileId, name) {
          const res = await this.apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
          });
          return res.json();
        },

        async moveFile(fileId, oldParentId, newParentId) {
          const params = new URLSearchParams({
            addParents: newParentId,
            removeParents: oldParentId,
            fields: 'id,name,parents'
          });
          const res = await this.apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?${params.toString()}`, {
            method: 'PATCH'
          });
          return res.json();
        },

        async trashFile(fileId) {
          await this.apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trashed: true })
          });
        },

        async listAllSubfolders(rootId) {
          // Lädt rekursiv alle Ordner unterhalb von rootId
          const all = [];
          const queue = [rootId];
          while (queue.length > 0) {
            const parentId = queue.shift();
            const q = encodeURIComponent(`'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
            const res = await this.apiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name,parents)&orderBy=name`);
            const data = await res.json();
            for (const f of (data.files || [])) {
              all.push(f);
              queue.push(f.id);
            }
          }
          return all;
        },

        async listFolderFiles(folderId) {
          const q = encodeURIComponent(`'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`);
          const res = await this.apiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=200&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)`);
          const data = await res.json();
          return data.files || [];
        },

        async downloadJson(fileId) {
          const res = await this.apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
          return res.json();
        },

        async getFileMeta(fileId) {
          const res = await this.apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,modifiedTime`);
          return res.json();
        },

        async fetchBlobUrl(fileId) {
          if (state.objectUrls.has(fileId)) return state.objectUrls.get(fileId);
          const res = await this.apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          state.objectUrls.set(fileId, url);
          return url;
        },

        async uploadMultipart(folderId, filename, mimeType, bodyBlob, existingFileId = null) {
          const metadata = existingFileId ? { name: filename } : { name: filename, parents: [folderId] };
          const form = new FormData();
          form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
          form.append('file', bodyBlob);

          const endpoint = existingFileId
            ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id,name,modifiedTime,mimeType,webViewLink`
            : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,mimeType,webViewLink`;

          const res = await this.apiFetch(endpoint, {
            method: existingFileId ? 'PATCH' : 'POST',
            body: form
          });
          return res.json();
        },

        async createGoogleDoc(folderId, title) {
          const res = await this.apiFetch('https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink,modifiedTime', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: title,
              mimeType: 'application/vnd.google-apps.document',
              parents: [folderId]
            })
          });
          return res.json();
        }
      };

      /* ========================================================================
         5. AUTHENTIFIZIERUNG & 401-OFFLINE-PUFFER
         ======================================================================== */
      function initAuthClient() {
        const { clientId, scope } = getSettings();
        if (!clientId || !window.google || !google.accounts || !google.accounts.oauth2) return false;
        state.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope,
          callback: async (tokenResponse) => {
            if (tokenResponse.error) {
              await uiAlert('Google Login fehlgeschlagen: ' + tokenResponse.error, 'Fehler');
              return;
            }
            state.accessToken = tokenResponse.access_token;
            state.tokenExpiresAt = Date.now() + (Number(tokenResponse.expires_in || 3600) * 1000);
            state.mode = 'drive';
            localStorage.removeItem(LS_KEYS.demoMode);
            document.getElementById('tokenExpiredBanner').classList.add('hidden');
            document.getElementById('demoBanner').classList.add('hidden');
            updateAuthUI();
            await flushPendingLocalSaves();
            await loadDriveWorkspace();
          }
        });
        return true;
      }

      function requestGoogleSignIn() {
        const { clientId } = getSettings();
        if (!clientId) {
          openModal('settingsModal');
          return;
        }
        if (!state.tokenClient && !initAuthClient()) {
          uiAlert('Google Identity Services Script wird noch geladen oder ist offline. Bitte kurz warten.');
          return;
        }
        state.tokenClient.requestAccessToken({ prompt: state.accessToken ? '' : 'consent' });
      }

      function handleTokenExpired() {
        state.accessToken = null;
        document.getElementById('tokenExpiredBanner').classList.remove('hidden');
        updateAuthUI();
      }

      function bufferBoardLocally(folderId, board) {
        const pending = JSON.parse(localStorage.getItem(LS_KEYS.pendingSaves) || '{}');
        pending[folderId] = { savedAt: Date.now(), board };
        localStorage.setItem(LS_KEYS.pendingSaves, JSON.stringify(pending));
      }

      async function flushPendingLocalSaves() {
        const pending = JSON.parse(localStorage.getItem(LS_KEYS.pendingSaves) || '{}');
        const folderIds = Object.keys(pending);
        if (folderIds.length === 0) return;
        showSyncStatus('Speichere gepufferte Änderungen nach Google Drive…', true);
        for (const fId of folderIds) {
          try {
            const files = await DriveAdapter.listFolderFiles(fId);
            const boardFile = files.find((f) => f.name === 'board.json');
            const blob = new Blob([JSON.stringify(pending[fId].board, null, 2)], { type: 'application/json' });
            await DriveAdapter.uploadMultipart(fId, 'board.json', 'application/json', blob, boardFile ? boardFile.id : null);
            delete pending[fId];
          } catch (e) {
            console.warn('Puffer-Sync fehlgeschlagen für', fId, e);
          }
        }
        localStorage.setItem(LS_KEYS.pendingSaves, JSON.stringify(pending));
        showSyncStatus('', false);
      }

      function updateAuthUI() {
        const statusEl = document.getElementById('authStatusText');
        const btn = document.getElementById('authActionBtn');
        if (state.mode === 'drive' && state.accessToken) {
          statusEl.innerHTML = '<span style="color:var(--accent-sage-dark);">●</span> Drive verbunden';
          btn.textContent = 'Aktualisieren';
        } else if (state.mode === 'demo') {
          statusEl.innerHTML = '<span style="color:var(--accent-oak);">●</span> Demo-Modus';
          btn.textContent = 'Verbinden';
        } else {
          statusEl.innerHTML = '<span style="color:var(--text-muted);">●</span> Getrennt';
          btn.textContent = 'Verbinden';
        }
      }

      /* ========================================================================
         6. WORKSPACE & ORDNER LADEN + SPEICHERN (MIT KONFLIKTSCHUTZ)
         ======================================================================== */
      async function loadRootMetadataDrive() {
        if (!state.rootFolderId || state.mode !== 'drive') return;
        try {
          const files = await DriveAdapter.listFolderFiles(state.rootFolderId);
          const tagFile = files.find((f) => f.name === 'tags.json');
          if (tagFile) {
            state.tagsFileId = tagFile.id;
            const data = await DriveAdapter.downloadJson(tagFile.id);
            if (Array.isArray(data.tags)) state.globalTags = data.tags;
          } else {
            await saveGlobalTags();
          }

          const locFile = files.find((f) => f.name === 'locations.json');
          if (locFile) {
            state.locationsFileId = locFile.id;
            const data = await DriveAdapter.downloadJson(locFile.id);
            if (Array.isArray(data.locations)) state.globalLocations = data.locations;
          } else {
            await saveGlobalLocations();
          }
        } catch (e) {
          console.warn('Root-Metadaten konnten nicht geladen werden:', e);
        }
      }

      async function saveGlobalLocations() {
        if (state.mode === 'demo') {
          const demo = DemoAdapter.load();
          demo.globalLocations = state.globalLocations;
          DemoAdapter.save(demo);
          return;
        }
        if (state.mode !== 'drive' || !state.rootFolderId || !state.accessToken) return;
        try {
          const blob = new Blob([JSON.stringify({ locations: state.globalLocations }, null, 2)], { type: 'application/json' });
          const saved = await DriveAdapter.uploadMultipart(state.rootFolderId, 'locations.json', 'application/json', blob, state.locationsFileId);
          state.locationsFileId = saved.id;
        } catch (e) {
          console.warn('locations.json konnte nicht gespeichert werden:', e);
        }
      }

      function renderGlobalLocationsManager() {
        const listEl = document.getElementById('globalLocationsList');
        if (!listEl) return;
        if (state.globalLocations.length === 0) {
          listEl.innerHTML = '<span style="font-size:0.84rem; color:var(--text-muted);">Noch keine Lagerorte angelegt.</span>';
          return;
        }
        listEl.innerHTML = state.globalLocations.map((loc, idx) => `
          <span class="meta-pill" style="padding-right:6px;">
            <span>📍 ${escapeHtml(loc)}</span>
            <button class="btn-icon" data-del-gloc="${idx}" type="button" style="width:20px; height:20px; font-size:0.7rem;" title="Lagerort löschen">✕</button>
          </span>
        `).join('');
        listEl.querySelectorAll('[data-del-gloc]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const idx = Number(btn.getAttribute('data-del-gloc'));
            const removed = state.globalLocations[idx];
            state.globalLocations.splice(idx, 1);
            state.activeLocationFilters.delete(removed);
            renderGlobalLocationsManager();
            await saveGlobalLocations();
            renderMainView();
          });
        });
      }

      function openLocationsManagerModal() {
        renderGlobalLocationsManager();
        openModal('locationsManagerModal');
      }

      function isInventoryFolder(folderId) {
        if (!folderId || !state.inventoryRootId) return false;
        let currId = folderId;
        const visited = new Set();
        while (currId && !visited.has(currId)) {
          if (currId === state.inventoryRootId) return true;
          visited.add(currId);
          const f = state.folders.find((x) => x.id === currId);
          currId = f && f.parents ? f.parents[0] : null;
        }
        return false;
      }

      function getInventoryFolders() {
        if (!state.inventoryRootId) return [];
        return state.folders.filter((f) => isInventoryFolder(f.id));
      }

      function resolveBoardItem(item, sourceFolderId = null) {
        if (!item) return null;
        if (item.type !== 'ref') {
          return {
            ...item,
            isRef: false,
            isMissingRef: false,
            targetItem: item,
            targetFolderId: sourceFolderId || state.activeFolderId,
            refItem: null
          };
        }
        const invContent = state.folderContents[item.refFolderId];
        const orig = invContent ? (invContent.board.items || []).find((i) => i.id === item.refItemId) : null;
        if (!orig) {
          return {
            ...item,
            type: 'bookmark',
            isRef: true,
            isMissingRef: true,
            title: item.title || '⚠️ Fehlendes Inventory-Element',
            note: 'Das Original im Inventory wurde gelöscht oder verschoben.',
            tags: item.tags || [],
            location: '',
            targetItem: null,
            targetFolderId: item.refFolderId,
            refItem: item
          };
        }
        const origPrice = orig.shopping && orig.shopping.price ? Number(orig.shopping.price) : 0;
        const refShop = item.shopping || { enabled: false, price: origPrice, quantity: 1, status: 'idea' };
        const mergedPrice = (refShop.price !== undefined && refShop.price !== null && refShop.price !== '' && Number(refShop.price) > 0)
          ? Number(refShop.price)
          : origPrice;
        return {
          ...orig,
          id: item.id,
          canvas: item.canvas,
          canvasHidden: item.canvasHidden,
          shopping: {
            enabled: !!refShop.enabled,
            price: mergedPrice,
            quantity: Math.max(1, Number(refShop.quantity) || 1),
            status: refShop.status || 'idea'
          },
          isRef: true,
          isMissingRef: false,
          refFolderId: item.refFolderId,
          refItemId: item.refItemId,
          targetItem: orig,
          targetFolderId: item.refFolderId,
          refItem: item
        };
      }

      async function preloadReferencedInventoryFolders(board) {
        if (!board || !Array.isArray(board.items)) return;
        const needed = Array.from(new Set(
          board.items
            .filter((it) => it.type === 'ref' && it.refFolderId && !state.folderContents[it.refFolderId])
            .map((it) => it.refFolderId)
        ));
        if (needed.length > 0 && typeof ensureFoldersLoaded === 'function') {
          await ensureFoldersLoaded(needed);
        }
      }

      async function saveGlobalTags() {
        if (state.mode === 'demo') {
          const demo = DemoAdapter.load();
          demo.globalTags = state.globalTags;
          DemoAdapter.save(demo);
          return;
        }
        if (state.mode !== 'drive' || !state.rootFolderId || !state.accessToken) return;
        try {
          const blob = new Blob([JSON.stringify({ tags: state.globalTags }, null, 2)], { type: 'application/json' });
          const saved = await DriveAdapter.uploadMultipart(state.rootFolderId, 'tags.json', 'application/json', blob, state.tagsFileId);
          state.tagsFileId = saved.id;
        } catch (e) {
          console.warn('tags.json konnte nicht gespeichert werden:', e);
        }
      }

      function renderGlobalTagsManager() {
        const listEl = document.getElementById('globalTagsList');
        if (state.globalTags.length === 0) {
          listEl.innerHTML = '<span style="font-size:0.84rem; color:var(--text-muted);">Noch keine Tags angelegt.</span>';
          return;
        }
        listEl.innerHTML = state.globalTags.map((tag, idx) => `
          <span class="meta-pill" style="padding-right:6px;">
            <span>#${escapeHtml(tag)}</span>
            <button class="btn-icon" data-del-gtag="${idx}" type="button" style="width:20px; height:20px; font-size:0.7rem;" title="Tag löschen">✕</button>
          </span>
        `).join('');
        listEl.querySelectorAll('[data-del-gtag]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const idx = Number(btn.getAttribute('data-del-gtag'));
            const removed = state.globalTags[idx];
            state.globalTags.splice(idx, 1);
            state.activeTagFilters.delete(removed);
            renderGlobalTagsManager();
            await saveGlobalTags();
            renderMainView();
          });
        });
      }

      function openTagsManagerModal() {
        renderGlobalTagsManager();
        openModal('tagsManagerModal');
      }

      function saveNavState() {
        if (state.activeFolderId) localStorage.setItem(LS_KEYS.lastFolderId, state.activeFolderId);
        localStorage.setItem(LS_KEYS.lastView, state.activeView || 'gallery');
        localStorage.setItem(LS_KEYS.lastQuickView, state.quickView || '');
      }

      async function loadDriveWorkspace() {
        showSyncStatus('Lade Ordnerstruktur aus Google Drive…', true);
        try {
          const { rootName } = getSettings();
          state.rootFolderId = await DriveAdapter.ensureRootFolder(rootName);
          await loadRootMetadataDrive();
          state.folders = await DriveAdapter.listAllSubfolders(state.rootFolderId);
          state.expandedFolders.add(state.rootFolderId);

          let invFolder = state.folders.find((f) => f.name === '_Inventory' && (f.parents || []).includes(state.rootFolderId));
          if (!invFolder) {
            invFolder = await DriveAdapter.createFolder(state.rootFolderId, '_Inventory');
            state.folders.push(invFolder);
          }
          state.inventoryRootId = invFolder.id;

          const savedFolderId = localStorage.getItem(LS_KEYS.lastFolderId);
          const savedView = localStorage.getItem(LS_KEYS.lastView);
          const savedQuick = localStorage.getItem(LS_KEYS.lastQuickView) || null;
          if (savedView) state.activeView = savedView;

          if (savedFolderId && state.folders.some((f) => f.id === savedFolderId)) {
            state.activeFolderId = savedFolderId;
          } else if (!state.activeFolderId || !state.folders.some((f) => f.id === state.activeFolderId)) {
            state.activeFolderId = state.folders.length > 0 ? state.folders[0].id : null;
          }

          // Elternordner im Baum automatisch mit ausklappen
          let curr = state.folders.find((f) => f.id === state.activeFolderId);
          while (curr && curr.parents && curr.parents[0]) {
            state.expandedFolders.add(curr.parents[0]);
            curr = state.folders.find((f) => f.id === curr.parents[0]);
          }

          renderSidebar();
          if (state.activeFolderId) {
            await openFolder(state.activeFolderId);
          } else {
            renderMainView();
          }
          if (savedQuick) {
            state.quickView = savedQuick;
            renderSidebar();
            renderMainView();
          }
        } catch (err) {
          console.error(err);
          await uiAlert(err.message, 'Fehler');
        } finally {
          showSyncStatus('', false);
        }
      }

      function startDemoMode() {
        state.mode = 'demo';
        localStorage.setItem(LS_KEYS.demoMode, '1');
        document.getElementById('demoBanner').classList.remove('hidden');
        document.getElementById('tokenExpiredBanner').classList.add('hidden');
        const demo = DemoAdapter.load();
        if (Array.isArray(demo.globalTags)) state.globalTags = demo.globalTags;
        if (Array.isArray(demo.globalLocations)) state.globalLocations = demo.globalLocations;
        state.rootFolderId = demo.rootFolderId;
        state.folders = demo.folders;
        let invFolder = state.folders.find((f) => f.name === '_Inventory' && (f.parents || []).includes(state.rootFolderId));
        if (!invFolder) {
          invFolder = { id: 'demo-inventory', name: '_Inventory', parents: [state.rootFolderId] };
          state.folders.push(invFolder);
          demo.boards[invFolder.id] = createDefaultBoard('Inventory');
          DemoAdapter.save(demo);
        }
        state.inventoryRootId = invFolder.id;
        state.expandedFolders.add(demo.rootFolderId);

        const savedFolderId = localStorage.getItem(LS_KEYS.lastFolderId);
        const savedView = localStorage.getItem(LS_KEYS.lastView);
        const savedQuick = localStorage.getItem(LS_KEYS.lastQuickView) || null;
        if (savedView) state.activeView = savedView;
        state.activeFolderId = (savedFolderId && demo.folders.some((f) => f.id === savedFolderId))
          ? savedFolderId
          : (demo.folders[0]?.id || null);

        updateAuthUI();
        renderSidebar();
        if (state.activeFolderId) openFolder(state.activeFolderId);
        else renderMainView();
        if (savedQuick) {
          state.quickView = savedQuick;
          renderSidebar();
          renderMainView();
        }
      }

      async function openFolder(folderId) {
        state.activeFolderId = folderId;
        state.quickView = null;
        state.selectedGalleryIds.clear();
        state.gallerySelectMode = false;
        saveNavState();
        revokeAllObjectUrls();
        renderSidebar();

        if (state.mode === 'demo') {
          const demo = DemoAdapter.load();
          const folder = demo.folders.find((f) => f.id === folderId);
          const board = demo.boards[folderId] || createDefaultBoard(folder?.name || 'Ordner');
          state.folderContents[folderId] = { board, boardFileId: null, modifiedTime: null, driveFiles: [] };
          await preloadReferencedInventoryFolders(board);
          renderMainView();
          return;
        }

        showSyncStatus('Lade Ordnerinhalte…', true);
        try {
          const files = await DriveAdapter.listFolderFiles(folderId);
          const boardFile = files.find((f) => f.name === 'board.json');
          const folder = state.folders.find((f) => f.id === folderId);
          let board = createDefaultBoard(folder ? folder.name : 'Projekt');

          if (boardFile) {
            board = await DriveAdapter.downloadJson(boardFile.id);
          }

          // Externe Dateien (z. B. Bilder, Google Docs, Sheets, PDFs) erkennen
          const otherFiles = files.filter((f) => f.name !== 'board.json');
          state.folderContents[folderId] = {
            board,
            boardFileId: boardFile ? boardFile.id : null,
            modifiedTime: boardFile ? boardFile.modifiedTime : null,
            driveFiles: otherFiles
          };

          // Falls Bilder per Drive direkt im Ordner liegen und noch nicht in board.items stehen, automatisch ergänzen
          let addedNew = false;
          for (const df of otherFiles) {
            if (df.mimeType.startsWith('image/')) {
              const exists = board.items.some((it) => it.driveFileId === df.id);
              if (!exists) {
                board.items.push({
                  id: uid('img'),
                  type: 'image',
                  driveFileId: df.id,
                  title: df.name.replace(/\.[^.]+$/, ''),
                  sourceUrl: '',
                  note: '',
                  tags: [],
                  shopping: { enabled: false, price: 0, quantity: 1, status: 'bought' }
                });
                addedNew = true;
              }
            }
          }
          if (addedNew) scheduleBoardSave(folderId);
          await preloadReferencedInventoryFolders(board);
          renderMainView();
        } catch (err) {
          console.error(err);
          if (err.status !== 401) await uiAlert(err.message, 'Fehler');
        } finally {
          showSyncStatus('', false);
        }
      }

      function scheduleBoardSave(folderId) {
        state.dirtyFolders.add(folderId);
        const content = state.folderContents[folderId];
        if (!content) return;

        if (state.mode === 'demo') {
          const demo = DemoAdapter.load();
          demo.boards[folderId] = content.board;
          DemoAdapter.save(demo);
          state.dirtyFolders.delete(folderId);
          return;
        }

        clearTimeout(state.saveTimers[folderId]);
        state.saveTimers[folderId] = setTimeout(() => {
          delete state.saveTimers[folderId];
          saveBoardNow(folderId);
        }, 700);
      }

      async function saveBoardNow(folderId, forceOverwrite = false) {
        const content = state.folderContents[folderId];
        if (!content) return;

        if (state.savingFolders.has(folderId)) {
          state.resaveFolders.add(folderId);
          return;
        }

        if (!state.accessToken) {
          bufferBoardLocally(folderId, content.board);
          handleTokenExpired();
          return;
        }

        state.savingFolders.add(folderId);
        try {
          // Konfliktschutz: modifiedTime & Session-ID prüfen bevor wir überschreiben
          if (content.boardFileId && content.modifiedTime && !forceOverwrite) {
            const remoteMeta = await DriveAdapter.getFileMeta(content.boardFileId);
            const localTs = Date.parse(content.modifiedTime) || 0;
            const remoteTs = Date.parse(remoteMeta.modifiedTime) || 0;
            if (remoteTs - localTs > 2000) {
              let isDifferentDevice = true;
              try {
                const remoteBoard = await DriveAdapter.downloadJson(content.boardFileId);
                if (remoteBoard && remoteBoard._lastUpdatedBy === CLIENT_SESSION_ID) {
                  isDifferentDevice = false;
                }
              } catch (e) { /* Im Zweifel Konflikt anzeigen */ }

              if (isDifferentDevice) {
                showSyncStatus('', false);
                state.pendingConflict = folderId;
                openModal('conflictModal');
                return;
              }
            }
          }

          content.board._lastUpdatedBy = CLIENT_SESSION_ID;
          const blob = new Blob([JSON.stringify(content.board, null, 2)], { type: 'application/json' });
          const saved = await DriveAdapter.uploadMultipart(folderId, 'board.json', 'application/json', blob, content.boardFileId);
          content.boardFileId = saved.id;
          content.modifiedTime = saved.modifiedTime;
          state.dirtyFolders.delete(folderId);
        } catch (err) {
          if (err.status === 401) {
            bufferBoardLocally(folderId, content.board);
          } else {
            await uiAlert('Fehler beim Speichern: ' + err.message, 'Fehler');
          }
        } finally {
          state.savingFolders.delete(folderId);
          showSyncStatus('', false);
          if (state.resaveFolders.has(folderId)) {
            state.resaveFolders.delete(folderId);
            saveBoardNow(folderId, forceOverwrite);
          }
        }
      }
