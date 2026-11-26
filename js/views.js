'use strict';

      /* ========================================================================
         7. SIDEBAR (VERSCHACHTELTER ORDNERBAUM)
         ======================================================================== */
      function renderSidebar() {
        const treeEl = document.getElementById('folderTree');
        document.querySelectorAll('.nav-item[data-quick]').forEach((btn) => {
          btn.classList.toggle('active', state.quickView === btn.getAttribute('data-quick'));
        });

        const tabsEl = document.getElementById('viewTabs');
        if (tabsEl) tabsEl.style.display = (state.mode === 'unauthenticated' || state.quickView) ? 'none' : 'flex';

        if (state.mode === 'unauthenticated') {
          treeEl.innerHTML = '<div style="padding:8px 10px; font-size:0.82rem; color:var(--text-muted);">Verbinde Google Drive oder starte den Demo-Modus.</div>';
          return;
        }

        function buildLevel(parentId) {
          const children = state.folders.filter((f) => (f.parents || []).includes(parentId));
          if (children.length === 0) return '';
          return children.map((folder) => {
            const hasSub = state.folders.some((c) => (c.parents || []).includes(folder.id));
            const isExpanded = state.expandedFolders.has(folder.id);
            const isActive = !state.quickView && state.activeFolderId === folder.id;
            return `
              <div class="tree-node" data-folder-id="${folder.id}">
                <div class="tree-row ${isActive ? 'active' : ''}">
                  <button class="tree-toggle ${hasSub ? '' : 'empty'}" data-toggle-folder="${folder.id}" type="button" title="${hasSub ? (isExpanded ? 'Zuklappen' : 'Ausklappen') : ''}">${hasSub ? (isExpanded ? '▼' : '▶') : ''}</button>
                  <span class="tree-label" data-select-folder="${folder.id}">📁 ${escapeHtml(folder.name)}</span>
                  <span class="tree-actions">
                    <button class="btn-icon" data-folder-menu="${folder.id}" type="button" title="Ordner-Aktionen">⋯</button>
                  </span>
                </div>
                ${hasSub && isExpanded ? `<div class="tree-children">${buildLevel(folder.id)}</div>` : ''}
              </div>
            `;
          }).join('');
        }

        const html = buildLevel(state.rootFolderId);
        treeEl.innerHTML = html || '<div style="padding:8px 10px; font-size:0.82rem; color:var(--text-muted);">Noch keine Projekte. Klicke oben auf ＋.</div>';

        treeEl.querySelectorAll('[data-toggle-folder]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-toggle-folder');
            if (state.expandedFolders.has(id)) state.expandedFolders.delete(id);
            else state.expandedFolders.add(id);
            renderSidebar();
          });
        });

        treeEl.querySelectorAll('[data-select-folder]').forEach((el) => {
          el.addEventListener('click', () => {
            openFolder(el.getAttribute('data-select-folder'));
            closeMobileSidebar();
          });
        });

        function closeFolderMenu() {
          const old = document.getElementById('treeMenuPopover');
          if (old) old.remove();
        }

        treeEl.querySelectorAll('[data-folder-menu]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const fId = btn.getAttribute('data-folder-menu');
            const existing = document.getElementById('treeMenuPopover');
            if (existing && existing.getAttribute('data-for') === fId) {
              closeFolderMenu();
              return;
            }
            closeFolderMenu();

            const rect = btn.getBoundingClientRect();
            const menu = document.createElement('div');
            menu.id = 'treeMenuPopover';
            menu.setAttribute('data-for', fId);
            menu.className = 'tree-menu-popover';
            menu.style.top = `${Math.min(window.innerHeight - 100, rect.bottom + 4)}px`;
            menu.style.left = `${Math.min(window.innerWidth - 185, rect.left)}px`;
            menu.innerHTML = `
              <button class="tree-menu-item" data-menu-action="sub" type="button">＋ Unterordner anlegen</button>
              <button class="tree-menu-item" data-menu-action="rename" type="button">✎ Umbenennen</button>
            `;
            menu.addEventListener('click', (ev) => ev.stopPropagation());
            menu.querySelector('[data-menu-action="sub"]').addEventListener('click', () => {
              closeFolderMenu();
              promptCreateFolder(fId);
            });
            menu.querySelector('[data-menu-action="rename"]').addEventListener('click', () => {
              closeFolderMenu();
              promptRenameFolder(fId);
            });
            document.body.appendChild(menu);
            document.addEventListener('click', closeFolderMenu, { once: true });
          });
        });
      }

      async function promptCreateFolder(parentId) {
        const res = await uiPromptForm('Neuen Ordner / Projekt anlegen', [
          { key: 'name', label: 'Name', placeholder: 'z. B. Weihnachten 2026', required: true }
        ]);
        if (!res || !res.name.trim()) return;
        const cleanName = res.name.trim();

        if (state.mode === 'demo') {
          const demo = DemoAdapter.load();
          const newFolder = { id: uid('demo-f'), name: cleanName, parents: [parentId] };
          demo.folders.push(newFolder);
          demo.boards[newFolder.id] = createDefaultBoard(cleanName);
          DemoAdapter.save(demo);
          state.folders = demo.folders;
          state.expandedFolders.add(parentId);
          await openFolder(newFolder.id);
          return;
        }

        showSyncStatus('Erstelle Ordner in Google Drive…', true);
        try {
          const created = await DriveAdapter.createFolder(parentId, cleanName);
          state.folders.push(created);
          state.expandedFolders.add(parentId);
          await openFolder(created.id);
        } catch (err) {
          await uiAlert(err.message, 'Fehler');
        } finally {
          showSyncStatus('', false);
        }
      }

      async function promptRenameFolder(folderId) {
        const folder = state.folders.find((f) => f.id === folderId);
        if (!folder) return;
        const res = await uiPromptForm('Ordner umbenennen', [
          { key: 'name', label: 'Neuer Ordnername', value: folder.name, required: true }
        ]);
        if (!res || !res.name.trim() || res.name.trim() === folder.name) return;
        const nextName = res.name.trim();

        if (state.mode === 'demo') {
          const demo = DemoAdapter.load();
          const target = demo.folders.find((f) => f.id === folderId);
          if (target) target.name = nextName;
          DemoAdapter.save(demo);
          state.folders = demo.folders;
          renderSidebar();
          renderMainView();
          return;
        }

        showSyncStatus('Benenne Ordner um…', true);
        try {
          await DriveAdapter.renameFile(folderId, nextName);
          folder.name = nextName;
          renderSidebar();
          renderMainView();
        } catch (err) {
          await uiAlert(err.message, 'Fehler');
        } finally {
          showSyncStatus('', false);
        }
      }

      /* ========================================================================
         8. HAUPTANSICHT & GALERIE
         ======================================================================== */
      function getFolderBreadcrumb(folderId) {
        const chain = [];
        let curr = state.folders.find((f) => f.id === folderId);
        while (curr) {
          chain.unshift(curr.name);
          const pid = (curr.parents || [])[0];
          curr = state.folders.find((f) => f.id === pid);
        }
        return ['Moodboards', ...chain].join(' › ');
      }

      function renderMainView() {
        const container = document.getElementById('viewContainer');
        const titleEl = document.getElementById('folderTitle');
        const breadEl = document.getElementById('breadcrumb');
        const statsEl = document.getElementById('folderStats');

        document.querySelectorAll('.view-tab').forEach((t) => {
          t.classList.toggle('active', t.getAttribute('data-view') === state.activeView);
        });

        const tabsEl = document.getElementById('viewTabs');
        if (tabsEl) tabsEl.style.display = (state.mode === 'unauthenticated' || state.quickView) ? 'none' : 'flex';

        if (state.mode === 'unauthenticated') {
          breadEl.textContent = 'Start';
          titleEl.textContent = 'Willkommen in deinem Moodboard';
          statsEl.textContent = '';
          container.innerHTML = `
            <div class="empty-state">
              <h2>Dein visuelles Moodboard auf Google Drive</h2>
              <p>Verbinde deinen Google-Drive-Ordner über die Einstellungen oder teste die Oberfläche direkt im lokalen Demo-Modus.</p>
              <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
                <button id="welcomeConnectBtn" class="btn btn-primary" type="button">Mit Google Drive verbinden</button>
                <button id="welcomeDemoBtn" class="btn" type="button">Demo-Modus testen</button>
              </div>
            </div>
          `;
          document.getElementById('welcomeConnectBtn').addEventListener('click', requestGoogleSignIn);
          document.getElementById('welcomeDemoBtn').addEventListener('click', startDemoMode);
          return;
        }

        if (state.quickView === 'all') {
          breadEl.textContent = 'Ansichten';
          titleEl.textContent = 'Alle Elemente';
          renderAllItemsGallery(container, statsEl);
          return;
        }

        if (state.quickView === 'shopping' || state.quickView === 'todos') {
          breadEl.textContent = 'Ansichten';
          titleEl.textContent = state.quickView === 'shopping' ? 'Einkaufsliste' : 'Offene To-dos';
          renderGlobalQuickView(container, statsEl, state.quickView);
          return;
        }

        if (!state.activeFolderId || !state.folderContents[state.activeFolderId]) {
          breadEl.textContent = 'Moodboards';
          titleEl.textContent = 'Kein Ordner ausgewählt';
          statsEl.textContent = '';
          container.innerHTML = `
            <div class="empty-state">
              <h2>Noch kein Projektordner vorhanden</h2>
              <p>Lege links über „＋“ dein erstes Hauptprojekt an (z. B. <em>Weihnachten 2026</em> oder <em>Wohnzimmer</em>).</p>
              <button id="emptyCreateBtn" class="btn btn-primary" type="button">＋ Erstes Projekt anlegen</button>
            </div>
          `;
          document.getElementById('emptyCreateBtn').addEventListener('click', () => promptCreateFolder(state.rootFolderId));
          return;
        }

        const folder = state.folders.find((f) => f.id === state.activeFolderId);
        const isProjectFolder = !!(folder && (folder.parents || []).includes(state.rootFolderId));

        if (state.activeView === 'planning') state.activeView = 'budget';
        if (!isProjectFolder && (state.activeView === 'home' || state.activeView === 'todos' || state.activeView === 'budget')) {
          state.activeView = 'gallery';
        }

        document.querySelectorAll('.view-tab').forEach((t) => {
          const isProjOnly = t.hasAttribute('data-project-only');
          t.style.display = (isProjOnly && !isProjectFolder) ? 'none' : '';
          t.classList.toggle('active', t.getAttribute('data-view') === state.activeView);
        });

        breadEl.textContent = getFolderBreadcrumb(state.activeFolderId);
        titleEl.textContent = folder ? folder.name : 'Projekt';

        if (state.activeView === 'gallery') {
          renderGalleryView(container, statsEl, state.activeFolderId);
        } else if (state.activeView === 'canvas') {
          renderCanvasView(container, statsEl, state.activeFolderId);
        } else if (state.activeView === 'home') {
          renderProjectHomeView(container, statsEl, state.activeFolderId);
        } else if (state.activeView === 'todos') {
          renderPlanningView(container, statsEl, state.activeFolderId, 'todos');
        } else {
          renderPlanningView(container, statsEl, state.activeFolderId, 'budget');
        }
      }

      function matchesSearch(item) {
        if (state.activeTagFilters.size > 0) {
          const itemTagsLower = new Set((item.tags || []).map((t) => t.toLowerCase()));
          for (const reqTag of state.activeTagFilters) {
            if (!itemTagsLower.has(reqTag.toLowerCase())) return false;
          }
        }
        const q = state.searchQuery.trim().toLowerCase();
        if (!q) return true;
        const aiColors = (item.ai && item.ai.colorNames) ? item.ai.colorNames : [];
        const aiLabels = (item.ai && item.ai.labels) ? item.ai.labels : [];
        const aiDesc = (item.ai && item.ai.description) ? item.ai.description : '';
        const haystack = [
          item.title,
          item.note,
          item.url,
          item.sourceUrl,
          aiDesc,
          ...(item.tags || []),
          ...aiColors,
          ...aiLabels
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      }

      function renderAllItemsGallery(container, statsEl) {
        const allItems = [];
        for (const [fId, data] of Object.entries(state.folderContents)) {
          const folder = state.folders.find((f) => f.id === fId);
          for (const item of (data.board.items || [])) {
            if (matchesSearch(item)) {
              allItems.push({ item, folderId: fId, folderName: folder ? folder.name : '' });
            }
          }
        }
        statsEl.textContent = `${allItems.length} Treffer in geladenen Ordnern`;
        if (allItems.length === 0) {
          container.innerHTML = '<div class="phase-placeholder">Keine passenden Elemente gefunden. Öffne zuerst deine Projektordner oder passe die Suche an.</div>';
          return;
        }
        container.innerHTML = `<div class="gallery-grid">${allItems.map((e) => renderItemCardHtml(e.item, e.folderName)).join('')}</div>`;
        bindGalleryItemEvents(container, null);
      }

      function sortGalleryItems(list) {
        const arr = list.slice();
        if (state.gallerySort === 'title_asc') {
          arr.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'de'));
        } else if (state.gallerySort === 'title_desc') {
          arr.sort((a, b) => (b.title || '').localeCompare(a.title || '', 'de'));
        } else if (state.gallerySort === 'price_asc') {
          arr.sort((a, b) => ((a.shopping && a.shopping.enabled ? Number(a.shopping.price || 0) : Infinity) - (b.shopping && b.shopping.enabled ? Number(b.shopping.price || 0) : Infinity)));
        } else if (state.gallerySort === 'price_desc') {
          arr.sort((a, b) => ((b.shopping && b.shopping.enabled ? Number(b.shopping.price || 0) : -1) - (a.shopping && a.shopping.enabled ? Number(a.shopping.price || 0) : -1)));
        }
        return arr;
      }

      function renderGalleryView(container, statsEl, folderId) {
        const content = state.folderContents[folderId];
        const items = sortGalleryItems((content.board.items || []).filter(matchesSearch));
        const docs = (content.driveFiles || []).filter((df) => !df.mimeType.startsWith('image/') && (!state.searchQuery.trim() || df.name.toLowerCase().includes(state.searchQuery.trim().toLowerCase())));

        statsEl.textContent = `${items.length} Elemente · ${docs.length} Drive-Dokumente`;

        container.innerHTML = `
          <div class="gallery-toolbar">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <div class="pill-group">
                <button class="pill-btn ${state.galleryMode === 'grid' ? 'active' : ''}" data-gmode="grid" type="button">Kacheln</button>
                <button class="pill-btn ${state.galleryMode === 'list' ? 'active' : ''}" data-gmode="list" type="button">Liste</button>
              </div>

              <div class="tag-filter-wrap">
                <button id="toggleTagFilterBtn" class="btn btn-sm ${state.activeTagFilters.size > 0 ? 'btn-oak' : ''}" type="button">
                  🏷️ Filter${state.activeTagFilters.size > 0 ? ` (${state.activeTagFilters.size})` : ''} ▾
                </button>
                <div id="tagFilterPopover" class="tag-filter-popover ${state.tagDropdownOpen ? '' : 'hidden'}">
                  <div style="display:flex; justify-content:space-between; align-items:center; padding:2px 4px 6px; border-bottom:1px solid var(--border-color); margin-bottom:4px;">
                    <strong style="font-size:0.78rem;">Tags filtern</strong>
                    ${state.activeTagFilters.size > 0 ? '<button id="clearTagFiltersBtn" class="btn btn-sm" style="padding:2px 8px; font-size:0.72rem;" type="button">Zurücksetzen</button>' : ''}
                  </div>
                  ${state.globalTags.map((tag) => `
                    <label class="tag-filter-option">
                      <input type="checkbox" data-tag-filter="${escapeHtml(tag)}" ${state.activeTagFilters.has(tag) ? 'checked' : ''} />
                      <span>#${escapeHtml(tag)}</span>
                    </label>
                  `).join('')}
                </div>
              </div>

              <select id="gallerySortSelect" class="form-control" style="width:auto; padding:5px 10px; font-size:0.8rem; border-radius:var(--radius-pill);" aria-label="Sortierung">
                <option value="newest" ${state.gallerySort === 'newest' ? 'selected' : ''}>Sortierung: Standard</option>
                <option value="title_asc" ${state.gallerySort === 'title_asc' ? 'selected' : ''}>Titel (A–Z)</option>
                <option value="title_desc" ${state.gallerySort === 'title_desc' ? 'selected' : ''}>Titel (Z–A)</option>
                <option value="price_asc" ${state.gallerySort === 'price_asc' ? 'selected' : ''}>Preis (aufsteigend)</option>
                <option value="price_desc" ${state.gallerySort === 'price_desc' ? 'selected' : ''}>Preis (absteigend)</option>
              </select>

              <button id="manageTagsBtn" class="btn btn-sm" type="button" title="Tag-Liste verwalten">⚙️ Tags</button>
              <button id="openRaindropImportBtn" class="btn btn-sm" type="button" title="Raindrop CSV in diesen Ordner importieren">📥 Import</button>
            </div>

            ${state.activeTagFilters.size > 0 ? `
              <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
                ${Array.from(state.activeTagFilters).map((t) => `
                  <button class="pill-btn active" data-remove-tag-chip="${escapeHtml(t)}" type="button" style="border:1px solid var(--accent-oak); font-size:0.74rem;">#${escapeHtml(t)} ✕</button>
                `).join('')}
              </div>
            ` : ''}
          </div>

          <div id="galleryDropzone" class="dropzone">
            <strong>Bilder hier ablegen</strong> oder klicken zum Hochladen (Laptop &amp; Handy-Kamera)
          </div>

          <div class="gallery-grid ${state.galleryMode === 'list' ? 'list-mode' : ''}">
            ${items.map((item) => renderItemCardHtml(item)).join('')}
            ${docs.map((df) => renderDriveDocCardHtml(df)).join('')}
          </div>
        `;

        document.getElementById('manageTagsBtn').addEventListener('click', openTagsManagerModal);
        document.getElementById('openRaindropImportBtn').addEventListener('click', () => {
          document.getElementById('raindropCsvInput').value = '';
          document.getElementById('raindropCsvSummary').textContent = 'Noch keine Datei ausgewählt.';
          document.getElementById('startRaindropImportBtn').disabled = true;
          state.parsedRaindropRows = null;
          openModal('raindropImportModal');
        });
        document.getElementById('gallerySortSelect').addEventListener('change', (e) => {
          state.gallerySort = e.target.value;
          renderGalleryView(container, statsEl, folderId);
        });

        const toggleFilterBtn = document.getElementById('toggleTagFilterBtn');
        const popover = document.getElementById('tagFilterPopover');
        toggleFilterBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          state.tagDropdownOpen = !state.tagDropdownOpen;
          popover.classList.toggle('hidden', !state.tagDropdownOpen);
        });
        popover.addEventListener('click', (e) => e.stopPropagation());

        const clearBtn = document.getElementById('clearTagFiltersBtn');
        if (clearBtn) {
          clearBtn.addEventListener('click', () => {
            state.activeTagFilters.clear();
            renderGalleryView(container, statsEl, folderId);
          });
        }
        container.querySelectorAll('input[data-tag-filter]').forEach((cb) => {
          cb.addEventListener('change', () => {
            const t = cb.getAttribute('data-tag-filter');
            if (cb.checked) state.activeTagFilters.add(t);
            else state.activeTagFilters.delete(t);
            renderGalleryView(container, statsEl, folderId);
          });
        });
        container.querySelectorAll('[data-remove-tag-chip]').forEach((btn) => {
          btn.addEventListener('click', () => {
            state.activeTagFilters.delete(btn.getAttribute('data-remove-tag-chip'));
            renderGalleryView(container, statsEl, folderId);
          });
        });

        container.querySelectorAll('[data-gmode]').forEach((btn) => {
          btn.addEventListener('click', () => {
            state.galleryMode = btn.getAttribute('data-gmode');
            renderGalleryView(container, statsEl, folderId);
          });
        });

        const dz = document.getElementById('galleryDropzone');
        dz.addEventListener('click', () => document.getElementById('fileUploadInput').click());
        dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', (e) => {
          e.preventDefault();
          dz.classList.remove('dragover');
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileUploads(e.dataTransfer.files);
          }
        });

        bindGalleryItemEvents(container, folderId);
      }

      function renderItemCardHtml(item, folderLabel = '') {
        const badge = item.type === 'image' ? 'Bild' : 'Bookmark';
        const tagsHtml = (item.tags || []).map((t) => `<span class="item-tag-pill">#${escapeHtml(t)}</span>`).join('');
        const thumbSrc = item.type === 'image'
          ? (item.localDataUrl || '')
          : (item.previewImageUrl || '');
        const shop = item.shopping && item.shopping.enabled ? item.shopping : null;
        const shopStatus = (item.shopping && item.shopping.status) ? item.shopping.status : 'idea';
        const shopLabels = { idea: '💡 Idee', ordered: '📦 Bestellt', bought: '✅ Gekauft' };
        const shopCardClass = `shop-${shopStatus}`;
        const priceVal = shop ? Number(shop.price || 0) : 0;
        const badgeText = priceVal > 0
          ? `${shopLabels[shopStatus] || '💡 Idee'} · ${priceVal.toFixed(2)} €`
          : (shopLabels[shopStatus] || '💡 Idee');
        const linkUrl = item.url || item.sourceUrl || '';

        return `
          <article class="item-card ${shopCardClass}" data-item-id="${item.id}">
            <div class="item-thumb" data-open-item="${item.id}">
              ${thumbSrc
                ? `<img src="${escapeHtml(thumbSrc)}" alt="${escapeHtml(item.title)}" data-drive-img="${item.driveFileId || ''}" />`
                : (item.driveFileId
                    ? `<img alt="${escapeHtml(item.title)}" data-drive-img="${item.driveFileId}" />`
                    : `<div class="doc-icon-box"><span>🔗</span><span class="doc-icon-label">Web-Link</span></div>`)
              }
              <span class="item-type-badge">${badge}</span>
              <span class="price-badge status-${shopStatus}">${badgeText}</span>
            </div>
            <div class="item-body">
              <div style="min-width:0; flex:1;">
                <h3 class="item-title">${escapeHtml(item.title || 'Ohne Titel')}</h3>
                ${item.note ? `<p class="item-note">${escapeHtml(item.note)}</p>` : ''}
                ${folderLabel ? `<div style="font-size:0.72rem; color:var(--accent-oak); margin-top:3px;">📁 ${escapeHtml(folderLabel)}</div>` : ''}
                ${tagsHtml ? `<div class="item-tags">${tagsHtml}</div>` : ''}
              </div>
              <div class="item-meta">
                <span>${linkUrl ? `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener" style="font-size:0.75rem;">↗ Quelle</a>` : ''}</span>
                <div class="item-actions">
                  <button class="btn-icon" data-toggle-shop="${item.id}" type="button" title="Auf Einkaufsliste setzen/entfernen" style="${shop ? 'color:var(--accent-fir); font-weight:700;' : ''}">🛒</button>
                  <button class="btn-icon" data-edit-item="${item.id}" type="button" title="Bearbeiten">✎</button>
                  <button class="btn-icon" data-item-menu="${item.id}" type="button" title="Weitere Aktionen">⋯</button>
                </div>
              </div>
            </div>
          </article>
        `;
      }

      function renderDriveDocCardHtml(df) {
        let icon = '📄';
        let label = 'Datei';
        if (df.mimeType.includes('document')) { icon = '📝'; label = 'Google Doc'; }
        else if (df.mimeType.includes('spreadsheet')) { icon = '📊'; label = 'Google Sheet'; }
        else if (df.mimeType.includes('pdf')) { icon = '📕'; label = 'PDF'; }

        return `
          <article class="item-card">
            <a class="item-thumb" href="${escapeHtml(df.webViewLink || '#')}" target="_blank" rel="noopener" style="text-decoration:none;">
              <div class="doc-icon-box">
                <span>${icon}</span>
                <span class="doc-icon-label">${label}</span>
              </div>
              <span class="item-type-badge">${label}</span>
            </a>
            <div class="item-body">
              <h3 class="item-title">${escapeHtml(df.name)}</h3>
              <div class="item-meta">
                <span>Google Drive Datei</span>
                <a class="btn-icon" href="${escapeHtml(df.webViewLink || '#')}" target="_blank" rel="noopener" title="In Google Drive öffnen">↗</a>
              </div>
            </div>
          </article>
        `;
      }

      function bindGalleryItemEvents(container, folderId) {
        // Drive-Bilder CORS-frei über alt=media -> Blob -> ObjectURL nachladen
        container.querySelectorAll('img[data-drive-img]').forEach(async (imgEl) => {
          const fileId = imgEl.getAttribute('data-drive-img');
          if (!fileId || state.mode !== 'drive') return;
          try {
            const url = await DriveAdapter.fetchBlobUrl(fileId);
            imgEl.src = url;
          } catch (e) {
            console.warn('Bild konnte nicht geladen werden:', fileId, e);
          }
        });

        container.querySelectorAll('[data-open-item]').forEach((el) => {
          el.addEventListener('click', () => {
            const id = el.getAttribute('data-open-item');
            const item = findItemById(id);
            if (!item) return;
            if (item.type === 'bookmark' && item.url) {
              window.open(item.url, '_blank', 'noopener');
              return;
            }
            openLightbox(item);
          });
        });

        container.querySelectorAll('[data-edit-item]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-edit-item');
            const item = findItemById(id);
            if (item) openItemModal(item);
          });
        });

        container.querySelectorAll('[data-item-menu]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-item-menu');
            const found = findItemWithFolder(id);
            if (!found) return;
            const { item, fId } = found;

            const old = document.getElementById('itemMenuPopover');
            if (old) {
              const same = old.getAttribute('data-for') === id;
              old.remove();
              if (same) return;
            }

            const rect = btn.getBoundingClientRect();
            const menu = document.createElement('div');
            menu.id = 'itemMenuPopover';
            menu.setAttribute('data-for', id);
            menu.className = 'tree-menu-popover';
            menu.style.top = `${Math.min(window.innerHeight - 130, rect.bottom + 4)}px`;
            menu.style.left = `${Math.max(10, Math.min(window.innerWidth - 195, rect.right - 180))}px`;
            menu.innerHTML = `
              <button class="tree-menu-item" data-im-action="canvas" type="button">
                ${item.canvasHidden ? '🎨 Auf Moodboard zeigen' : '🎨 Vom Moodboard ausblenden'}
              </button>
              <button class="tree-menu-item" data-im-action="delete" type="button" style="color:var(--danger);">
                🗑 Löschen
              </button>
            `;
            menu.addEventListener('click', (ev) => ev.stopPropagation());
            menu.querySelector('[data-im-action="canvas"]').addEventListener('click', () => {
              menu.remove();
              item.canvasHidden = !item.canvasHidden;
              scheduleBoardSave(fId);
              renderMainView();
            });
            menu.querySelector('[data-im-action="delete"]').addEventListener('click', () => {
              menu.remove();
              deleteItemById(id, folderId || fId);
            });
            document.body.appendChild(menu);
            document.addEventListener('click', () => menu.remove(), { once: true });
          });
        });

        container.querySelectorAll('[data-toggle-shop]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-toggle-shop');
            const found = findItemWithFolder(id);
            if (!found) return;
            const { item, fId } = found;
            if (!item.shopping) item.shopping = { enabled: false, price: 0, quantity: 1, status: 'idea' };
            item.shopping.enabled = !item.shopping.enabled;
            scheduleBoardSave(fId);
            renderMainView();
          });
        });
      }

      function findItemById(itemId) {
        const res = findItemWithFolder(itemId);
        return res ? res.item : null;
      }

      function findItemWithFolder(itemId) {
        for (const [fId, data] of Object.entries(state.folderContents)) {
          const found = (data.board.items || []).find((i) => i.id === itemId);
          if (found) return { item: found, fId };
        }
        return null;
      }

      async function deleteItemById(itemId, folderId) {
        if (!(await uiConfirm('Dieses Element wirklich entfernen?', 'Element löschen', 'Löschen'))) return;
        const targetFolderId = folderId || state.activeFolderId;
        const content = state.folderContents[targetFolderId];
        if (!content) return;
        const item = content.board.items.find((i) => i.id === itemId);
        content.board.items = content.board.items.filter((i) => i.id !== itemId);
        scheduleBoardSave(targetFolderId);
        if (item && item.driveFileId && state.mode === 'drive') {
          try { await DriveAdapter.trashFile(item.driveFileId); } catch (e) { console.warn(e); }
        }
        renderMainView();
      }

      /* ========================================================================
         9. BILDUPLOAD, BOOKMARKS & GOOGLE DOC ERSTELLEN
         ======================================================================== */
      async function handleFileUploads(fileList) {
        if (!state.activeFolderId) {
          await uiAlert('Bitte wähle zuerst einen Projektordner aus.');
          return;
        }
        const folderId = state.activeFolderId;
        const content = state.folderContents[folderId];
        const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
        if (files.length === 0) return;

        showSyncStatus(`Lade ${files.length} Bild(er) hoch…`, true);
        try {
          const { geminiKey } = getSettings();
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const objUrl = URL.createObjectURL(file);
            const aiColors = await analyzeColorsFromUrl(objUrl);
            let newItem;
            if (state.mode === 'demo') {
              const dataUrl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(file);
              });
              newItem = {
                id: uid('img'),
                type: 'image',
                localDataUrl: dataUrl,
                title: file.name.replace(/\.[^.]+$/, ''),
                sourceUrl: '',
                note: '',
                tags: [],
                ai: { ...aiColors, labels: [] }
              };
            } else {
              const uploaded = await DriveAdapter.uploadMultipart(folderId, file.name, file.type, file);
              state.objectUrls.set(uploaded.id, objUrl);
              newItem = {
                id: uid('img'),
                type: 'image',
                driveFileId: uploaded.id,
                title: file.name.replace(/\.[^.]+$/, ''),
                sourceUrl: '',
                note: '',
                tags: [],
                ai: { ...aiColors, labels: [] }
              };
            }
            if (geminiKey) {
              showSyncStatus(`Analysiere Bild ${i + 1}/${files.length} mit Gemini…`, true);
              try {
                const gRes = await analyzeImageWithGemini(newItem.localDataUrl || objUrl, geminiKey);
                applyGeminiResultToItem(newItem, gRes, true);
              } catch (ge) {
                console.warn('Gemini-Analyse übersprungen:', ge.message);
              }
              if (i < files.length - 1) await new Promise((r) => setTimeout(r, 2000));
            }
            if (state.mode === 'demo') URL.revokeObjectURL(objUrl);
            content.board.items.unshift(newItem);
          }
          scheduleBoardSave(folderId);
          renderMainView();
        } catch (err) {
          await uiAlert('Upload fehlgeschlagen: ' + err.message, 'Fehler');
        } finally {
          showSyncStatus('', false);
        }
      }

      async function createNewGoogleDoc() {
        if (!state.activeFolderId) {
          await uiAlert('Bitte wähle zuerst einen Ordner aus.');
          return;
        }
        if (state.mode !== 'drive') {
          await uiAlert('Google Docs können nur erstellt werden, wenn du mit Google Drive verbunden bist.');
          return;
        }
        const res = await uiPromptForm('Neues Google Doc erstellen', [
          { key: 'title', label: 'Dokument-Name', value: 'Projekt-Notizen', required: true }
        ]);
        if (!res || !res.title.trim()) return;
        showSyncStatus('Erstelle Google Doc…', true);
        try {
          const doc = await DriveAdapter.createGoogleDoc(state.activeFolderId, res.title.trim());
          state.folderContents[state.activeFolderId].driveFiles.unshift(doc);
          renderMainView();
          if (doc.webViewLink) window.open(doc.webViewLink, '_blank', 'noopener');
        } catch (err) {
          await uiAlert(err.message, 'Fehler');
        } finally {
          showSyncStatus('', false);
        }
      }

      /* ========================================================================
         10. MODALS (EINSTELLUNGEN, BOOKMARK/ITEM, LIGHTBOX)
         ======================================================================== */
      function openModal(id) {
        document.getElementById(id).classList.remove('hidden');
      }

      function closeModal(id) {
        document.getElementById(id).classList.add('hidden');
      }

      function renderItemTagPicker() {
        const picker = document.getElementById('itemTagPicker');
        const allOptions = Array.from(new Set([...state.globalTags, ...state.editingItemTags]));
        if (allOptions.length === 0) {
          picker.innerHTML = '<span style="font-size:0.8rem; color:var(--text-muted);">Noch keine Tags angelegt.</span>';
          return;
        }
        picker.innerHTML = allOptions.map((tag) => {
          const active = state.editingItemTags.has(tag);
          return `<button type="button" class="pill-btn ${active ? 'active' : ''}" data-pick-tag="${escapeHtml(tag)}" style="border:1px solid ${active ? 'var(--accent-oak)' : 'var(--border-color)'};">#${escapeHtml(tag)}</button>`;
        }).join('');
        picker.querySelectorAll('[data-pick-tag]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const t = btn.getAttribute('data-pick-tag');
            if (state.editingItemTags.has(t)) state.editingItemTags.delete(t);
            else state.editingItemTags.add(t);
            renderItemTagPicker();
          });
        });
      }

      function openItemModal(item = null) {
        if (!state.activeFolderId && !item) {
          uiAlert('Bitte wähle zuerst einen Projektordner aus.');
          return;
        }
        state.editingItem = item;
        const isBookmark = !item || item.type === 'bookmark';
        document.getElementById('itemModalTitle').textContent = item ? 'Element bearbeiten' : 'Neues Web-Bookmark';
        document.getElementById('itemTitleInput').value = item ? (item.title || '') : '';
        document.getElementById('itemUrlInput').value = item ? (item.url || item.sourceUrl || '') : '';
        document.getElementById('itemPreviewInput').value = item ? (item.previewImageUrl || '') : '';
        document.getElementById('itemNoteInput').value = item ? (item.note || '') : '';
        state.editingItemTags = new Set(item && Array.isArray(item.tags) ? item.tags : []);
        renderItemTagPicker();
        document.getElementById('itemPreviewGroup').style.display = isBookmark ? 'block' : 'none';
        document.getElementById('fetchBookmarkMetaBtn').style.display = isBookmark ? 'inline-flex' : 'none';
        document.getElementById('bookmarkMetaHint').textContent = isBookmark ? 'Beim Einfügen einer URL werden Titel & Vorschaubild automatisch geladen.' : '';
        updateBookmarkPreviewThumb();
        const shop = item && item.shopping ? item.shopping : { enabled: false, price: '', quantity: 1, status: 'idea' };
        document.getElementById('itemShopEnabled').checked = !!shop.enabled;
        document.getElementById('itemShopPrice').value = shop.price || '';
        document.getElementById('itemShopQty').value = shop.quantity || 1;
        document.getElementById('itemShopStatus').value = shop.status || 'idea';
        openModal('itemModal');
      }

      async function openLightbox(item) {
        document.getElementById('lightboxTitle').textContent = item.title || 'Bildvorschau';
        document.getElementById('lightboxNote').textContent = item.note || '';
        const linkWrap = document.getElementById('lightboxLinkWrap');
        const url = item.sourceUrl || item.url;
        linkWrap.innerHTML = url ? `Quelle: <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>` : '';
        const img = document.getElementById('lightboxImg');
        if (item.localDataUrl) {
          img.src = item.localDataUrl;
        } else if (item.driveFileId && state.mode === 'drive') {
          img.src = await DriveAdapter.fetchBlobUrl(item.driveFileId);
        } else {
          img.src = item.previewImageUrl || '';
        }
        openModal('lightboxModal');
      }

      /* ========================================================================
         11. THEME & MOBILE SIDEBAR
         ======================================================================== */
      function applyTheme(mode) {
        const isEvening = mode === 'evening';
        document.documentElement.classList.toggle('evening-mode', isEvening);
        document.body.classList.toggle('evening-mode', isEvening);
        document.getElementById('themeToggleBtn').textContent = isEvening ? '🌙 Abend' : '☀️ Tag';
        localStorage.setItem(LS_KEYS.theme, mode);
      }

      function closeMobileSidebar() {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebarOverlay').classList.remove('open');
      }

      /* ========================================================================
         12. EVENT-BINDINGS & INITIALISIERUNG
         ======================================================================== */
      document.querySelectorAll('[data-close-modal]').forEach((btn) => {
        btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close-modal')));
      });

      document.getElementById('openSidebarBtn').addEventListener('click', () => {
        if (window.innerWidth <= 860) {
          document.getElementById('sidebar').classList.add('open');
          document.getElementById('sidebarOverlay').classList.add('open');
        } else {
          const collapsed = document.body.classList.toggle('sidebar-collapsed');
          localStorage.setItem('mb_sidebar_collapsed', collapsed ? '1' : '0');
        }
      });
      if (localStorage.getItem('mb_sidebar_collapsed') === '1' && window.innerWidth > 860) {
        document.body.classList.add('sidebar-collapsed');
      }
      document.getElementById('closeSidebarBtn').addEventListener('click', closeMobileSidebar);
      document.getElementById('sidebarOverlay').addEventListener('click', closeMobileSidebar);

      document.getElementById('themeToggleBtn').addEventListener('click', () => {
        const next = document.body.classList.contains('evening-mode') ? 'day' : 'evening';
        applyTheme(next);
      });

      document.getElementById('openSettingsBtn').addEventListener('click', () => {
        const s = getSettings();
        document.getElementById('clientIdInput').value = s.clientId;
        document.getElementById('rootFolderInput').value = s.rootName;
        document.getElementById('scopeSelect').value = s.scope;
        document.getElementById('geminiKeyInput').value = s.geminiKey;
        openModal('settingsModal');
      });

      document.getElementById('saveSettingsBtn').addEventListener('click', () => {
        localStorage.setItem(LS_KEYS.clientId, document.getElementById('clientIdInput').value.trim());
        localStorage.setItem(LS_KEYS.rootName, document.getElementById('rootFolderInput').value.trim() || 'Moodboards');
        localStorage.setItem(LS_KEYS.scope, document.getElementById('scopeSelect').value);
        localStorage.setItem(LS_KEYS.geminiKey, document.getElementById('geminiKeyInput').value.trim());
        state.tokenClient = null;
        closeModal('settingsModal');
        initAuthClient();
      });

      document.getElementById('authActionBtn').addEventListener('click', () => {
        if (state.mode === 'drive' && state.accessToken) loadDriveWorkspace();
        else requestGoogleSignIn();
      });
      document.getElementById('renewSessionBtn').addEventListener('click', requestGoogleSignIn);
      document.getElementById('exitDemoBtn').addEventListener('click', requestGoogleSignIn);

      document.getElementById('newRootFolderBtn').addEventListener('click', () => {
        if (state.mode === 'unauthenticated') {
          uiAlert('Bitte verbinde dich zuerst mit Google Drive oder starte den Demo-Modus.');
          return;
        }
        promptCreateFolder(state.rootFolderId);
      });

      document.getElementById('addImageBtn').addEventListener('click', () => {
        if (!state.activeFolderId) { uiAlert('Bitte wähle zuerst einen Ordner aus.'); return; }
        document.getElementById('fileUploadInput').click();
      });

      document.getElementById('fileUploadInput').addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFileUploads(e.target.files);
        e.target.value = '';
      });

      function updateBookmarkPreviewThumb() {
        const prevUrl = document.getElementById('itemPreviewInput').value.trim();
        const img = document.getElementById('itemPreviewThumb');
        if (prevUrl) {
          img.src = prevUrl;
          img.style.display = 'block';
        } else {
          img.style.display = 'none';
        }
      }

      async function fetchBookmarkMetadata(force = false) {
        if (state.editingItem && state.editingItem.type === 'image') return;
        const url = document.getElementById('itemUrlInput').value.trim();
        if (!url || !/^https?:\/\//i.test(url)) return;

        const titleInp = document.getElementById('itemTitleInput');
        const prevInp = document.getElementById('itemPreviewInput');
        const noteInp = document.getElementById('itemNoteInput');
        const hintEl = document.getElementById('bookmarkMetaHint');

        if (!force && prevInp.value.trim() && titleInp.value.trim()) return;

        hintEl.textContent = '⏳ Lade Titel & Vorschaubild…';
        try {
          const res = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`);
          const json = await res.json();
          if (json && json.status === 'success' && json.data) {
            if ((!titleInp.value.trim() || force) && json.data.title) {
              titleInp.value = json.data.title.trim();
            }
            const imgUrl = (json.data.image && json.data.image.url) || (json.data.logo && json.data.logo.url) || '';
            if ((!prevInp.value.trim() || force) && imgUrl) {
              prevInp.value = imgUrl;
            }
            if (!noteInp.value.trim() && json.data.description) {
              noteInp.value = json.data.description.trim();
            }
            hintEl.textContent = imgUrl ? '✅ Titel & Vorschaubild geladen.' : 'ℹ️ Titel geladen (kein OG-Bild gefunden – Screenshot-Fallback genutzt).';
          }
          if (!prevInp.value.trim()) {
            prevInp.value = `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=600`;
          }
          updateBookmarkPreviewThumb();
        } catch (e) {
          if (!prevInp.value.trim()) {
            prevInp.value = `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=600`;
            updateBookmarkPreviewThumb();
          }
          hintEl.textContent = 'ℹ️ Seiten-Screenshot als Vorschaubild gesetzt.';
        }
      }

      document.getElementById('fetchBookmarkMetaBtn').addEventListener('click', () => fetchBookmarkMetadata(true));
      document.getElementById('itemUrlInput').addEventListener('change', () => fetchBookmarkMetadata(false));
      document.getElementById('itemUrlInput').addEventListener('paste', () => setTimeout(() => fetchBookmarkMetadata(false), 60));
      document.getElementById('itemPreviewInput').addEventListener('input', updateBookmarkPreviewThumb);

      document.getElementById('addBookmarkBtn').addEventListener('click', () => openItemModal(null));

      /* ========================================================================
         12b. RAINDROP CSV IMPORTER
         ======================================================================== */
      function parseCsvText(text) {
        const rows = [];
        let curRow = [];
        let curVal = '';
        let inQuotes = false;
        const clean = text.replace(/^\uFEFF/, '');
        for (let i = 0; i < clean.length; i++) {
          const ch = clean[i];
          const next = clean[i + 1];
          if (inQuotes) {
            if (ch === '"' && next === '"') { curVal += '"'; i++; }
            else if (ch === '"') { inQuotes = false; }
            else { curVal += ch; }
          } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { curRow.push(curVal); curVal = ''; }
            else if (ch === '\r' && next === '\n') { curRow.push(curVal); rows.push(curRow); curRow = []; curVal = ''; i++; }
            else if (ch === '\n' || ch === '\r') { curRow.push(curVal); rows.push(curRow); curRow = []; curVal = ''; }
            else { curVal += ch; }
          }
        }
        if (curVal.length > 0 || curRow.length > 0) {
          curRow.push(curVal);
          rows.push(curRow);
        }
        if (rows.length < 2) return [];
        const headers = rows[0].map((h) => h.trim().toLowerCase());
        return rows.slice(1)
          .filter((r) => r.some((cell) => cell.trim() !== ''))
          .map((r) => {
            const obj = {};
            headers.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
            return obj;
          });
      }

      function unwrapRaindropCover(coverUrl) {
        if (!coverUrl) return '';
        const prefix = 'https://rdl.ink/render/';
        if (coverUrl.startsWith(prefix)) {
          try { return decodeURIComponent(coverUrl.slice(prefix.length)); } catch (e) { return coverUrl; }
        }
        return coverUrl;
      }

      async function getOrCreateSubfolder(parentId, name) {
        const existing = state.folders.find((f) => (f.parents || []).includes(parentId) && f.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing.id;
        if (state.mode === 'demo') {
          const demo = DemoAdapter.load();
          const newF = { id: uid('demo-f'), name, parents: [parentId] };
          demo.folders.push(newF);
          demo.boards[newF.id] = createDefaultBoard(name);
          DemoAdapter.save(demo);
          state.folders = demo.folders;
          return newF.id;
        }
        const created = await DriveAdapter.createFolder(parentId, name);
        state.folders.push(created);
        return created.id;
      }

      document.getElementById('raindropCsvInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        const rows = parseCsvText(text);
        state.parsedRaindropRows = rows;
        const folders = Array.from(new Set(rows.map((r) => r.folder).filter(Boolean)));
        document.getElementById('raindropCsvSummary').textContent = rows.length > 0
          ? `✅ ${rows.length} Einträge erkannt (${folders.length} Ordner-Pfade)`
          : '⚠️ Keine gültigen Einträge gefunden.';
        document.getElementById('startRaindropImportBtn').disabled = rows.length === 0;
      });

      document.getElementById('startRaindropImportBtn').addEventListener('click', async () => {
        const rows = state.parsedRaindropRows || [];
        if (!state.activeFolderId || rows.length === 0) return;

        const createSubs = document.getElementById('raindropCreateSubfoldersCb').checked;
        const uploadImgs = document.getElementById('raindropUploadImagesCb').checked;
        const importTags = document.getElementById('raindropImportTagsCb').checked;

        closeModal('raindropImportModal');
        showSyncStatus(`Importiere ${rows.length} Raindrop-Einträge…`, true);

        // Gemeinsames Ordner-Präfix ermitteln (z. B. "Aktuelle Projekte / Weihnachten / Deko / Advent")
        const folderPartsList = rows.map((r) => (r.folder || '').split('/').map((s) => s.trim()).filter(Boolean)).filter((p) => p.length > 0);
        let commonLen = 0;
        if (folderPartsList.length > 0) {
          const minLen = Math.min(...folderPartsList.map((p) => p.length));
          while (commonLen < minLen && folderPartsList.every((p) => p[commonLen] === folderPartsList[0][commonLen])) {
            commonLen++;
          }
        }

        const touchedFolders = new Set([state.activeFolderId]);
        let importedCount = 0;
        let skippedCount = 0;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          showSyncStatus(`Importiere ${i + 1}/${rows.length}…`, true);

          let targetFolderId = state.activeFolderId;
          if (createSubs && row.folder) {
            const parts = row.folder.split('/').map((s) => s.trim()).filter(Boolean).slice(commonLen);
            for (const pName of parts) {
              targetFolderId = await getOrCreateSubfolder(targetFolderId, pName);
            }
          }
          await ensureFoldersLoaded([targetFolderId]);
          touchedFolders.add(targetFolderId);

          const fc = state.folderContents[targetFolderId];
          const url = row.url || '';
          const coverUrl = unwrapRaindropCover(row.cover || '');
          const isDup = url && (fc.board.items || []).some((it) => it.url === url || it.sourceUrl === url);
          if (isDup) { skippedCount++; continue; }

          // Tags verarbeiten
          const rawTags = (row.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
          if (importTags) {
            for (const t of rawTags) {
              if (!state.globalTags.some((g) => g.toLowerCase() === t.toLowerCase())) {
                state.globalTags.push(t);
              }
            }
          }
          const allowedMap = new Map(state.globalTags.map((t) => [t.toLowerCase(), t]));
          const finalTags = rawTags.map((t) => allowedMap.get(t.toLowerCase())).filter(Boolean);

          const isRaindropFile = /api\.raindrop\.io\/v2\/raindrop\/\d+\/file/i.test(url) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url);
          const imgCandidate = coverUrl || (isRaindropFile ? url : '');
          let driveFileId = '';
          let localDataUrl = '';

          if (uploadImgs && imgCandidate) {
            try {
              const res = await fetch(imgCandidate);
              if (res.ok) {
                const blob = await res.blob();
                if (blob.type.startsWith('image/')) {
                  if (state.mode === 'demo') {
                    localDataUrl = await new Promise((resolve) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(reader.result);
                      reader.readAsDataURL(blob);
                    });
                  } else if (state.mode === 'drive') {
                    const ext = (blob.type.split('/')[1] || 'jpg').split(';')[0];
                    const fname = `rd-${row.id || Date.now()}.${ext}`;
                    const up = await DriveAdapter.uploadMultipart(targetFolderId, fname, blob.type, blob);
                    driveFileId = up.id;
                  }
                }
              }
            } catch (e) { /* CORS-geschützt -> Fallback auf previewImageUrl */ }
          }

          const title = row.title || (isRaindropFile ? 'Raindrop Bild' : url);
          const note = [row.note, row.excerpt].filter((s) => s && s !== 'null').join(' — ');

          fc.board.items.push({
            id: uid(driveFileId || localDataUrl ? 'img' : 'bm'),
            type: (driveFileId || localDataUrl) ? 'image' : 'bookmark',
            driveFileId: driveFileId || undefined,
            localDataUrl: localDataUrl || undefined,
            url: isRaindropFile ? '' : url,
            sourceUrl: isRaindropFile ? '' : url,
            previewImageUrl: (!driveFileId && !localDataUrl) ? imgCandidate : '',
            title,
            note,
            tags: Array.from(new Set(finalTags))
          });
          importedCount++;
        }

        if (importTags) await saveGlobalTags();
        for (const fId of touchedFolders) {
          scheduleBoardSave(fId);
        }
        renderSidebar();
        renderMainView();
        showSyncStatus(`✅ ${importedCount} importiert (${skippedCount} übersprungen)`, true);
        setTimeout(() => showSyncStatus('', false), 3200);
      });
      document.getElementById('addDocBtn').addEventListener('click', createNewGoogleDoc);

      document.getElementById('saveItemBtn').addEventListener('click', () => {
        const title = document.getElementById('itemTitleInput').value.trim();
        const url = document.getElementById('itemUrlInput').value.trim();
        const previewImageUrl = document.getElementById('itemPreviewInput').value.trim();
        const note = document.getElementById('itemNoteInput').value.trim();
        const tags = Array.from(state.editingItemTags);
        const shopping = {
          enabled: document.getElementById('itemShopEnabled').checked,
          price: Math.max(0, parseFloat(document.getElementById('itemShopPrice').value) || 0),
          quantity: Math.max(1, parseInt(document.getElementById('itemShopQty').value, 10) || 1),
          status: document.getElementById('itemShopStatus').value || 'idea'
        };

        if (state.editingItem) {
          state.editingItem.title = title || 'Ohne Titel';
          if (state.editingItem.type === 'image') state.editingItem.sourceUrl = url;
          else {
            state.editingItem.url = url;
            state.editingItem.previewImageUrl = previewImageUrl;
          }
          state.editingItem.note = note;
          state.editingItem.tags = tags;
          state.editingItem.shopping = shopping;
          const found = findItemWithFolder(state.editingItem.id);
          scheduleBoardSave(found ? found.fId : state.activeFolderId);
        } else {
          if (!url) { uiAlert('Bitte gib eine URL ein.'); return; }
          const content = state.folderContents[state.activeFolderId];
          content.board.items.unshift({
            id: uid('bm'),
            type: 'bookmark',
            url,
            previewImageUrl,
            title: title || url,
            note,
            tags,
            shopping
          });
          scheduleBoardSave(state.activeFolderId);
        }
        closeModal('itemModal');
        renderMainView();
      });

      document.getElementById('conflictReloadBtn').addEventListener('click', async () => {
        const fId = state.pendingConflict;
        state.pendingConflict = null;
        closeModal('conflictModal');
        if (fId) await openFolder(fId);
      });

      document.getElementById('conflictOverwriteBtn').addEventListener('click', async () => {
        const fId = state.pendingConflict;
        state.pendingConflict = null;
        closeModal('conflictModal');
        if (fId) await saveBoardNow(fId, true);
      });

      document.querySelectorAll('.view-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          state.activeView = tab.getAttribute('data-view');
          state.quickView = null;
          saveNavState();
          renderMainView();
        });
      });

      document.querySelectorAll('.nav-item[data-quick]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          state.quickView = btn.getAttribute('data-quick');
          saveNavState();
          renderSidebar();
          closeMobileSidebar();
          const allIds = state.folders.map((f) => f.id);
          if (allIds.some((id) => !state.folderContents[id])) {
            showSyncStatus('Lade alle Projekte für die Übersicht…', true);
            await ensureFoldersLoaded(allIds);
            showSyncStatus('', false);
          }
          renderMainView();
        });
      });

      document.getElementById('searchInput').addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        renderMainView();
      });


      /* ========================================================================
         16. PHASE 3: TO-DOS, EINKAUFSLISTE, BUDGET & SPLIT-VIEW
         ======================================================================== */
      function getSubtreeFolderIds(rootId) {
        const result = [rootId];
        const queue = [rootId];
        while (queue.length > 0) {
          const pid = queue.shift();
          const children = state.folders.filter((f) => (f.parents || []).includes(pid));
          for (const ch of children) {
            result.push(ch.id);
            queue.push(ch.id);
          }
        }
        return result;
      }

      async function ensureFoldersLoaded(folderIds) {
        for (const fId of folderIds) {
          if (state.folderContents[fId]) continue;
          if (state.mode === 'demo') {
            const demo = DemoAdapter.load();
            const f = demo.folders.find((x) => x.id === fId);
            state.folderContents[fId] = {
              board: demo.boards[fId] || createDefaultBoard(f ? f.name : 'Ordner'),
              boardFileId: null,
              modifiedTime: null,
              driveFiles: []
            };
          } else if (state.mode === 'drive' && state.accessToken) {
            try {
              const files = await DriveAdapter.listFolderFiles(fId);
              const boardFile = files.find((f) => f.name === 'board.json');
              const f = state.folders.find((x) => x.id === fId);
              const board = boardFile ? await DriveAdapter.downloadJson(boardFile.id) : createDefaultBoard(f ? f.name : 'Projekt');
              state.folderContents[fId] = {
                board,
                boardFileId: boardFile ? boardFile.id : null,
                modifiedTime: boardFile ? boardFile.modifiedTime : null,
                driveFiles: files.filter((x) => x.name !== 'board.json')
              };
            } catch (e) {
              console.warn('Unterordner konnte nicht geladen werden:', fId, e);
            }
          }
        }
      }

      function collectPlanningData(folderId, includeSubfolders) {
        const ids = includeSubfolders ? getSubtreeFolderIds(folderId) : [folderId];
        const shoppingEntries = [];
        const todoEntries = [];

        for (const fId of ids) {
          const content = state.folderContents[fId];
          if (!content) continue;
          const folder = state.folders.find((f) => f.id === fId);
          const fName = folder ? folder.name : 'Ordner';

          // Verknüpfte Bilder / Bookmarks
          for (const item of (content.board.items || [])) {
            if (item.shopping && item.shopping.enabled) {
              shoppingEntries.push({
                kind: 'item',
                folderId: fId,
                folderName: fName,
                id: item.id,
                title: item.title || 'Ohne Titel',
                url: item.url || item.sourceUrl || '',
                thumbUrl: item.localDataUrl || item.previewImageUrl || '',
                driveFileId: item.driveFileId || '',
                price: Number(item.shopping.price || 0),
                quantity: Number(item.shopping.quantity || 1),
                status: item.shopping.status || 'idea',
                ref: item
              });
            }
          }

          // Freie Text-Einkaufsposten
          for (const mItem of (content.board.manualShoppingItems || [])) {
            shoppingEntries.push({
              kind: 'manual',
              folderId: fId,
              folderName: fName,
              id: mItem.id,
              title: mItem.title,
              url: mItem.url || '',
              thumbUrl: '',
              driveFileId: '',
              price: Number(mItem.price || 0),
              quantity: Number(mItem.quantity || 1),
              status: mItem.status || 'idea',
              ref: mItem
            });
          }

          // To-dos
          for (const td of (content.board.todos || [])) {
            todoEntries.push({ folderId: fId, folderName: fName, ref: td });
          }
        }

        const planned = shoppingEntries.reduce((sum, e) => sum + e.price * e.quantity, 0);
        const spent = shoppingEntries.filter((e) => e.status === 'bought').reduce((sum, e) => sum + e.price * e.quantity, 0);
        return { shoppingEntries, todoEntries, planned, spent };
      }

      async function renderPlanningView(container, statsEl, folderId, mode = 'budget') {
        const content = state.folderContents[folderId];
        if (!content.board.budget) content.board.budget = { limit: 0, currency: 'EUR', includeSubfolders: true };
        if (!Array.isArray(content.board.manualShoppingItems)) content.board.manualShoppingItems = [];
        if (!Array.isArray(content.board.todos)) content.board.todos = [];

        const budget = content.board.budget;
        const subtreeIds = getSubtreeFolderIds(folderId);
        if ((budget.includeSubfolders || mode === 'todos') && subtreeIds.some((id) => !state.folderContents[id])) {
          await ensureFoldersLoaded(subtreeIds);
        }

        const { shoppingEntries, todoEntries, planned, spent } = collectPlanningData(folderId, mode === 'todos' ? true : budget.includeSubfolders);
        const limit = Number(budget.limit || 0);
        const remaining = limit - planned;
        const pct = limit > 0 ? Math.min(100, Math.round((planned / limit) * 100)) : 0;

        if (mode === 'todos') {
          const todoCats = ['Alle', ...Array.from(new Set(todoEntries.map((t) => t.ref.category || 'Allgemein')))];
          const visibleTodos = state.todoFilter === 'Alle'
            ? todoEntries
            : todoEntries.filter((t) => (t.ref.category || 'Allgemein') === state.todoFilter);
          const doneTodos = todoEntries.filter((t) => t.ref.done).length;
          const todoPct = todoEntries.length > 0 ? Math.round((doneTodos / todoEntries.length) * 100) : 0;
          statsEl.textContent = `${todoEntries.filter((t) => !t.ref.done).length} offene To-dos`;

          container.innerHTML = `
            <section class="planning-card">
              <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px;">
                <h3 style="margin:0; font-size:1.05rem;">☑️ To-do-Liste</h3>
                <span style="font-size:0.8rem; color:var(--text-muted);">${doneTodos} / ${todoEntries.length} (${todoPct} %)</span>
              </div>

              <div class="progress-track" style="margin-bottom:12px;">
                <div class="progress-fill" style="width:${todoPct}%;"></div>
              </div>

              <div class="pill-group" style="margin-bottom:12px; flex-wrap:wrap;">
                ${todoCats.map((cat) => `
                  <button class="pill-btn ${state.todoFilter === cat ? 'active' : ''}" data-tfilter="${escapeHtml(cat)}" type="button">${escapeHtml(cat)}</button>
                `).join('')}
              </div>

              <div style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap;">
                <input id="newTodoText" class="form-control" type="text" placeholder="Neue Aufgabe…" style="flex:1; min-width:150px;" />
                <input id="newTodoCat" class="form-control" type="text" placeholder="Bereich/Kategorie" style="width:140px;" />
                <button id="addTodoBtn" class="btn btn-primary btn-sm" type="button">＋</button>
              </div>

              ${visibleTodos.length === 0
                ? '<p style="font-size:0.85rem; color:var(--text-muted); margin:0;">Keine Aufgaben in diesem Filter.</p>'
                : visibleTodos.map((entry) => `
                  <div class="todo-row ${entry.ref.done ? 'done' : ''}" data-todo-id="${entry.ref.id}" data-todo-folder="${entry.folderId}">
                    <input type="checkbox" data-todo-toggle="1" ${entry.ref.done ? 'checked' : ''} />
                    <div style="flex:1; min-width:0;">
                      <div class="todo-text" style="font-size:0.88rem;">${escapeHtml(entry.ref.text)}</div>
                      <div style="font-size:0.72rem; color:var(--text-muted);">
                        ${escapeHtml(entry.ref.category || 'Allgemein')}${entry.folderId !== folderId ? ` · 📁 ${escapeHtml(entry.folderName)}` : ''}
                      </div>
                    </div>
                    <button class="btn-icon" data-todo-edit="1" type="button" title="Bearbeiten">✎</button>
                    <button class="btn-icon" data-todo-del="1" type="button" title="Löschen">🗑</button>
                  </div>
                `).join('')
              }
            </section>
          `;

          container.querySelectorAll('[data-tfilter]').forEach((b) => {
            b.addEventListener('click', () => {
              state.todoFilter = b.getAttribute('data-tfilter');
              renderPlanningView(container, statsEl, folderId, 'todos');
            });
          });
          document.getElementById('addTodoBtn').addEventListener('click', () => {
            const text = document.getElementById('newTodoText').value.trim();
            if (!text) return;
            const category = document.getElementById('newTodoCat').value.trim() || 'Allgemein';
            content.board.todos.push({ id: uid('t'), text, done: false, category });
            scheduleBoardSave(folderId);
            renderPlanningView(container, statsEl, folderId, 'todos');
          });
          container.querySelectorAll('.todo-row').forEach((row) => {
            const id = row.getAttribute('data-todo-id');
            const fId = row.getAttribute('data-todo-folder');
            const fc = state.folderContents[fId];
            const todo = fc.board.todos.find((t) => t.id === id);
            if (!todo) return;
            row.querySelector('[data-todo-toggle]').addEventListener('change', (e) => {
              todo.done = e.target.checked;
              scheduleBoardSave(fId);
              renderPlanningView(container, statsEl, folderId, 'todos');
            });
            row.querySelector('[data-todo-edit]').addEventListener('click', async () => {
              const res = await uiPromptForm('Aufgabe bearbeiten', [
                { key: 'text', label: 'Aufgabe', value: todo.text, required: true },
                { key: 'category', label: 'Bereich / Kategorie', value: todo.category || 'Allgemein' }
              ]);
              if (!res || !res.text.trim()) return;
              todo.text = res.text.trim();
              todo.category = (res.category || '').trim() || 'Allgemein';
              scheduleBoardSave(fId);
              renderPlanningView(container, statsEl, folderId, 'todos');
            });
            row.querySelector('[data-todo-del]').addEventListener('click', () => {
              fc.board.todos = fc.board.todos.filter((t) => t.id !== id);
              scheduleBoardSave(fId);
              renderPlanningView(container, statsEl, folderId, 'todos');
            });
          });
          return;
        }

        // mode === 'budget'
        statsEl.textContent = `${shoppingEntries.length} Einkaufsposten · ${planned.toFixed(2)} € verplant`;
        const visibleShop = state.shopFilter === 'all'
          ? shoppingEntries
          : shoppingEntries.filter((e) => e.status === state.shopFilter);

        container.innerHTML = `
          <section class="planning-card" style="margin-bottom:20px;">
            <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px;">
              <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                <strong style="font-size:1.05rem;">💶 Budget-Rechner</strong>
                <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.82rem; color:var(--text-secondary);">
                  Limit (€):
                  <input id="budgetLimitInput" class="form-control" type="number" min="0" step="10" value="${limit}" style="width:110px; padding:5px 8px;" />
                </label>
              </div>
              <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.84rem; cursor:pointer;">
                <input id="budgetIncludeSubCb" type="checkbox" ${budget.includeSubfolders ? 'checked' : ''} />
                <span>Unterordner mit einrechnen (${subtreeIds.length - 1})</span>
              </label>
            </div>

            <div class="budget-grid">
              <div class="budget-stat">
                <div class="budget-stat-label">Budget-Limit</div>
                <div class="budget-stat-val">${limit.toFixed(2)} €</div>
              </div>
              <div class="budget-stat">
                <div class="budget-stat-label">Verplant (Gesamt)</div>
                <div class="budget-stat-val">${planned.toFixed(2)} €</div>
              </div>
              <div class="budget-stat">
                <div class="budget-stat-label">Ausgegeben (Gekauft)</div>
                <div class="budget-stat-val">${spent.toFixed(2)} €</div>
              </div>
              <div class="budget-stat">
                <div class="budget-stat-label">Restbudget</div>
                <div class="budget-stat-val ${limit > 0 && remaining < 0 ? 'over' : ''}">
                  ${limit > 0 ? remaining.toFixed(2) + ' €' : '—'}
                </div>
              </div>
            </div>

            ${limit > 0 ? `
              <div class="progress-track">
                <div class="progress-fill ${remaining < 0 ? 'over' : ''}" style="width:${pct}%;"></div>
              </div>
            ` : ''}
          </section>

          <section class="planning-card">
            <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; margin-bottom:12px;">
              <h3 style="margin:0; font-size:1.05rem;">🛒 Einkaufsliste</h3>
              <div class="pill-group">
                <button class="pill-btn ${state.shopFilter === 'all' ? 'active' : ''}" data-sfilter="all" type="button">Alle</button>
                <button class="pill-btn ${state.shopFilter === 'idea' ? 'active' : ''}" data-sfilter="idea" type="button">Idee</button>
                <button class="pill-btn ${state.shopFilter === 'ordered' ? 'active' : ''}" data-sfilter="ordered" type="button">Bestellt</button>
                <button class="pill-btn ${state.shopFilter === 'bought' ? 'active' : ''}" data-sfilter="bought" type="button">Gekauft</button>
              </div>
            </div>

            <div style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap;">
              <input id="manualShopTitle" class="form-control" type="text" placeholder="Freier Posten (z. B. Servietten)" style="flex:1; min-width:140px;" />
              <input id="manualShopPrice" class="form-control" type="number" step="0.01" min="0" placeholder="€" style="width:80px;" />
              <button id="addManualShopBtn" class="btn btn-oak btn-sm" type="button">＋</button>
            </div>

            ${visibleShop.length === 0
              ? '<p style="font-size:0.85rem; color:var(--text-muted); margin:0;">Noch keine Posten in dieser Ansicht. Klicke in der Galerie bei einem Bild/Bookmark auf „🛒“ oder füge oben einen Posten hinzu.</p>'
              : visibleShop.map((entry) => `
                <div class="shop-row" data-shop-kind="${entry.kind}" data-shop-id="${entry.id}" data-shop-folder="${entry.folderId}">
                  ${entry.thumbUrl || entry.driveFileId
                    ? `<img class="shop-thumb" src="${escapeHtml(entry.thumbUrl)}" data-drive-img="${entry.driveFileId}" alt="" />`
                    : '<div class="shop-thumb" style="display:flex; align-items:center; justify-content:center;">🛍️</div>'}
                  <div style="flex:1; min-width:0;">
                    <div style="font-size:0.88rem; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                      ${escapeHtml(entry.title)}
                      ${entry.url ? `<a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener" title="Shop-Link öffnen">↗</a>` : ''}
                    </div>
                    <div style="font-size:0.74rem; color:var(--text-muted);">
                      ${entry.folderId !== folderId ? `📁 ${escapeHtml(entry.folderName)} · ` : ''}${(entry.price * entry.quantity).toFixed(2)} € gesamt
                    </div>
                  </div>
                  <input class="form-control" data-shop-field="price" type="number" step="0.01" min="0" value="${entry.price}" style="width:74px; padding:4px 6px; font-size:0.8rem;" title="Einzelpreis (€)" />
                  <input class="form-control" data-shop-field="quantity" type="number" min="1" value="${entry.quantity}" style="width:52px; padding:4px 6px; font-size:0.8rem;" title="Menge" />
                  <select class="form-control" data-shop-field="status" style="width:94px; padding:4px 6px; font-size:0.8rem;">
                    <option value="idea" ${entry.status === 'idea' ? 'selected' : ''}>Idee</option>
                    <option value="ordered" ${entry.status === 'ordered' ? 'selected' : ''}>Bestellt</option>
                    <option value="bought" ${entry.status === 'bought' ? 'selected' : ''}>Gekauft</option>
                  </select>
                  <button class="btn-icon" data-edit-shop="1" type="button" title="Titel &amp; Link bearbeiten">✎</button>
                  <button class="btn-icon" data-remove-shop="1" type="button" title="Von Einkaufsliste entfernen">✕</button>
                </div>
              `).join('')
            }
          </section>
        `;

        container.querySelectorAll('img[data-drive-img]').forEach(async (imgEl) => {
          const fId = imgEl.getAttribute('data-drive-img');
          if (!fId || state.mode !== 'drive') return;
          try { imgEl.src = await DriveAdapter.fetchBlobUrl(fId); } catch (e) { console.warn(e); }
        });

        document.getElementById('budgetLimitInput').addEventListener('change', (e) => {
          budget.limit = Math.max(0, parseFloat(e.target.value) || 0);
          scheduleBoardSave(folderId);
          renderPlanningView(container, statsEl, folderId, 'budget');
        });
        document.getElementById('budgetIncludeSubCb').addEventListener('change', (e) => {
          budget.includeSubfolders = e.target.checked;
          scheduleBoardSave(folderId);
          renderPlanningView(container, statsEl, folderId, 'budget');
        });

        container.querySelectorAll('[data-sfilter]').forEach((b) => {
          b.addEventListener('click', () => {
            state.shopFilter = b.getAttribute('data-sfilter');
            renderPlanningView(container, statsEl, folderId, 'budget');
          });
        });

        document.getElementById('addManualShopBtn').addEventListener('click', () => {
          const title = document.getElementById('manualShopTitle').value.trim();
          if (!title) return;
          const price = Math.max(0, parseFloat(document.getElementById('manualShopPrice').value) || 0);
          content.board.manualShoppingItems.push({ id: uid('ms'), title, price, quantity: 1, status: 'idea', url: '' });
          scheduleBoardSave(folderId);
          renderPlanningView(container, statsEl, folderId, 'budget');
        });

        container.querySelectorAll('.shop-row').forEach((row) => {
          const kind = row.getAttribute('data-shop-kind');
          const id = row.getAttribute('data-shop-id');
          const fId = row.getAttribute('data-shop-folder');
          const entry = shoppingEntries.find((e) => e.id === id && e.folderId === fId);
          if (!entry) return;

          row.querySelectorAll('[data-shop-field]').forEach((inp) => {
            inp.addEventListener('change', () => {
              const field = inp.getAttribute('data-shop-field');
              const val = field === 'status' ? inp.value : (field === 'quantity' ? Math.max(1, parseInt(inp.value, 10) || 1) : Math.max(0, parseFloat(inp.value) || 0));
              if (kind === 'item') entry.ref.shopping[field] = val;
              else entry.ref[field] = val;
              scheduleBoardSave(fId);
              renderPlanningView(container, statsEl, folderId, 'budget');
            });
          });

          row.querySelector('[data-edit-shop]').addEventListener('click', async () => {
            if (kind === 'item') {
              openItemModal(entry.ref);
            } else {
              const res = await uiPromptForm('Einkaufsposten bearbeiten', [
                { key: 'title', label: 'Bezeichnung', value: entry.ref.title, required: true },
                { key: 'url', label: 'Shop-Link / URL (optional)', value: entry.ref.url || '', type: 'url', placeholder: 'https://...' }
              ]);
              if (!res || !res.title.trim()) return;
              entry.ref.title = res.title.trim();
              entry.ref.url = (res.url || '').trim();
              scheduleBoardSave(fId);
              renderPlanningView(container, statsEl, folderId, 'budget');
            }
          });

          row.querySelector('[data-remove-shop]').addEventListener('click', () => {
            if (kind === 'item') {
              entry.ref.shopping.enabled = false;
            } else {
              const fc = state.folderContents[fId];
              fc.board.manualShoppingItems = fc.board.manualShoppingItems.filter((x) => x.id !== id);
            }
            scheduleBoardSave(fId);
            renderPlanningView(container, statsEl, folderId, 'budget');
          });
        });
      }

      function renderGlobalQuickView(container, statsEl, type) {
        const allFolders = Object.keys(state.folderContents);
        if (allFolders.length === 0) {
          container.innerHTML = '<div class="phase-placeholder">Öffne zuerst einen oder mehrere Projektordner, um die globale Übersicht zu sehen.</div>';
          return;
        }

        if (type === 'shopping') {
          const rows = [];
          for (const fId of allFolders) {
            const { shoppingEntries } = collectPlanningData(fId, false);
            rows.push(...shoppingEntries);
          }
          const total = rows.reduce((s, r) => s + r.price * r.quantity, 0);
          statsEl.textContent = `${rows.length} Posten · Gesamt: ${total.toFixed(2)} €`;
          if (rows.length === 0) {
            container.innerHTML = '<div class="phase-placeholder">Noch keine Einkaufsposten in den geladenen Ordnern.</div>';
            return;
          }
          container.innerHTML = `
            <div class="planning-card">
              ${rows.map((r) => `
                <div class="shop-row">
                  <div style="flex:1;">
                    <strong>${escapeHtml(r.title)}</strong>
                    ${r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">↗</a>` : ''}
                    <div style="font-size:0.76rem; color:var(--text-muted);">📁 ${escapeHtml(r.folderName)} · Status: ${escapeHtml(r.status)}</div>
                  </div>
                  <div style="font-weight:600;">${(r.price * r.quantity).toFixed(2)} € (${r.quantity}×)</div>
                </div>
              `).join('')}
            </div>
          `;
        } else {
          const openTodos = [];
          for (const fId of allFolders) {
            const { todoEntries } = collectPlanningData(fId, false);
            openTodos.push(...todoEntries.filter((t) => !t.ref.done));
          }
          statsEl.textContent = `${openTodos.length} offene Aufgaben`;
          if (openTodos.length === 0) {
            container.innerHTML = '<div class="phase-placeholder">Alle Aufgaben in den geladenen Ordnern sind erledigt!</div>';
            return;
          }
          container.innerHTML = `
            <div class="planning-card">
              ${openTodos.map((t) => `
                <div class="todo-row">
                  <input type="checkbox" data-qt-id="${t.ref.id}" data-qt-folder="${t.folderId}" />
                  <div style="flex:1;">
                    <div class="todo-text">${escapeHtml(t.ref.text)}</div>
                    <div style="font-size:0.74rem; color:var(--text-muted);">📁 ${escapeHtml(t.folderName)} · ${escapeHtml(t.ref.category || 'Allgemein')}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          `;
          container.querySelectorAll('[data-qt-id]').forEach((cb) => {
            cb.addEventListener('change', () => {
              const fc = state.folderContents[cb.getAttribute('data-qt-folder')];
              const td = fc.board.todos.find((x) => x.id === cb.getAttribute('data-qt-id'));
              if (td) {
                td.done = cb.checked;
                scheduleBoardSave(cb.getAttribute('data-qt-folder'));
                renderGlobalQuickView(container, statsEl, 'todos');
              }
            });
          });
        }
      }

      function renderSplitPlanningPanel(panelEl, folderId) {
        const content = state.folderContents[folderId];
        const { shoppingEntries, todoEntries, planned } = collectPlanningData(folderId, false);
        const limit = Number((content.board.budget && content.board.budget.limit) || 0);

        panelEl.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <strong style="font-size:0.95rem;">📋 Kurzplanung</strong>
            <span style="font-size:0.78rem; color:var(--text-muted);">${planned.toFixed(2)} € ${limit > 0 ? '/ ' + limit + ' €' : ''}</span>
          </div>

          <div style="font-size:0.76rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin:10px 0 6px;">Einkaufsliste (${shoppingEntries.length})</div>
          ${shoppingEntries.length === 0
            ? '<p style="font-size:0.8rem; color:var(--text-muted); margin:0;">Keine Posten.</p>'
            : shoppingEntries.map((e) => `
              <div style="display:flex; justify-content:space-between; gap:6px; font-size:0.82rem; padding:4px 0; border-bottom:1px solid var(--border-color);">
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(e.title)}</span>
                <strong style="white-space:nowrap;">${(e.price * e.quantity).toFixed(2)} €</strong>
              </div>
            `).join('')}

          <div style="font-size:0.76rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin:14px 0 6px;">To-dos (${todoEntries.filter((t) => !t.ref.done).length} offen)</div>
          ${todoEntries.length === 0
            ? '<p style="font-size:0.8rem; color:var(--text-muted); margin:0;">Keine Aufgaben.</p>'
            : todoEntries.map((t) => `
              <label style="display:flex; align-items:center; gap:6px; font-size:0.82rem; padding:4px 0; cursor:pointer;">
                <input type="checkbox" data-split-todo="${t.ref.id}" ${t.ref.done ? 'checked' : ''} />
                <span style="${t.ref.done ? 'text-decoration:line-through; color:var(--text-muted);' : ''}">${escapeHtml(t.ref.text)}</span>
              </label>
            `).join('')}
        `;

        panelEl.querySelectorAll('[data-split-todo]').forEach((cb) => {
          cb.addEventListener('change', () => {
            const td = content.board.todos.find((x) => x.id === cb.getAttribute('data-split-todo'));
            if (td) {
              td.done = cb.checked;
              scheduleBoardSave(folderId);
              renderSplitPlanningPanel(panelEl, folderId);
            }
          });
        });
      }
