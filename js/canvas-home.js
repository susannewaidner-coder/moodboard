'use strict';

      /* ========================================================================
         13. PHASE 2: MOODBOARD-CANVAS & FARBPALETTEN-CHECK
         ======================================================================== */
      function extractColorsFromImages(imgElements, maxColors = 6) {
        const buckets = new Map();
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d', { willReadFrequently: true });
        c.width = 36;
        c.height = 36;

        for (const img of imgElements) {
          if (!img.complete || img.naturalWidth === 0) continue;
          try {
            ctx.clearRect(0, 0, 36, 36);
            ctx.drawImage(img, 0, 0, 36, 36);
            const data = ctx.getImageData(0, 0, 36, 36).data;
            for (let i = 0; i < data.length; i += 16) {
              const r = Math.round(data[i] / 32) * 32;
              const g = Math.round(data[i + 1] / 32) * 32;
              const b = Math.round(data[i + 2] / 32) * 32;
              const a = data[i + 3];
              if (a < 128) continue;
              const key = `${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)}`;
              buckets.set(key, (buckets.get(key) || 0) + 1);
            }
          } catch (e) {
            // Externe ungeschützte Bookmark-URLs ohne CORS überspringen
          }
        }

        return Array.from(buckets.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, maxColors)
          .map(([rgb]) => {
            const [r, g, b] = rgb.split(',').map(Number);
            return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
          });
      }

      function renderCanvasView(container, statsEl, folderId) {
        const content = state.folderContents[folderId];
        const visualItems = (content.board.items || []).filter((it) => it.type === 'image' || it.previewImageUrl);
        statsEl.textContent = `${visualItems.length} Bilder auf dem Canvas`;

        // Initiale Positionen vergeben, falls noch keine Canvas-Koordinaten existieren
        let changed = false;
        visualItems.forEach((item, idx) => {
          if (!item.canvas) {
            const col = idx % 4;
            const row = Math.floor(idx / 4);
            item.canvas = { x: 40 + col * 250, y: 40 + row * 240, w: 220, h: 210, z: idx + 1 };
            changed = true;
          }
        });
        if (changed) scheduleBoardSave(folderId);

        if (visualItems.length === 0) {
          container.innerHTML = `
            <div class="phase-placeholder">
              <h3 style="margin-top:0; color:var(--text-primary);">Noch keine Bilder auf diesem Moodboard</h3>
              <p>Lade über „＋ Bild“ Fotos hoch oder wechsle in die Galerie – sie erscheinen dann automatisch hier zum freien Nebeneinanderstellen.</p>
            </div>
          `;
          return;
        }

        const cs = content.board.canvasSettings || {};
        const fitMode = cs.fitMode || state.canvasFitMode;
        const bgMode = cs.bgMode || state.canvasBg;
        const showGrid = cs.showGrid !== undefined ? cs.showGrid : state.canvasShowGrid;

        container.innerHTML = `
          <div class="canvas-toolbar">
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <button id="canvasZoomOutBtn" class="btn btn-sm" type="button" title="Verkleinern">－</button>
              <span id="canvasZoomLabel" style="font-size:0.8rem; min-width:44px; text-align:center;">${Math.round(state.canvasZoom * 100)} %</span>
              <button id="canvasZoomInBtn" class="btn btn-sm" type="button" title="Vergrößern">＋</button>
              <button id="canvasResetViewBtn" class="btn btn-sm" type="button">100 %</button>

              <button id="canvasFitBtn" class="btn btn-sm ${fitMode === 'contain' ? 'btn-oak' : ''}" type="button" title="Zwischen ganzem Bild und zugeschnittenem Kachel-Fill wechseln">
                ${fitMode === 'contain' ? '🖼️ Ganzes Bild' : '✂️ Ausfüllen'}
              </button>

              <select id="canvasRatioSelect" class="form-control" style="width:auto; padding:4px 8px; font-size:0.78rem; border-radius:var(--radius-pill);" title="Kachel-Format auf Auswahl (oder alle) anwenden">
                <option value="">📐 Format anwenden…</option>
                <option value="original">Original-Proportion</option>
                <option value="1:1">Quadrat (1:1)</option>
                <option value="4:3">Querformat (4:3)</option>
                <option value="3:4">Hochformat (3:4)</option>
              </select>

              <button id="canvasAutoLayoutBtn" class="btn btn-sm" type="button" title="Richtet Kacheln am Raster aus und behält deine Reihenfolge bei">🧲 Am Raster ausrichten</button>
              <button id="canvasLayerUpBtn" class="btn btn-sm" type="button" title="Auswahl nach vorne">⬆️</button>
              <button id="canvasLayerDownBtn" class="btn btn-sm" type="button" title="Auswahl nach hinten">⬇️</button>

              <select id="canvasBgSelect" class="form-control" style="width:auto; padding:4px 8px; font-size:0.78rem; border-radius:var(--radius-pill);" title="Canvas-Hintergrund">
                <option value="default" ${bgMode === 'default' ? 'selected' : ''}>Hintergrund: Standard</option>
                <option value="white" ${bgMode === 'white' ? 'selected' : ''}>Hintergrund: Weiß</option>
                <option value="dark" ${bgMode === 'dark' ? 'selected' : ''}>Hintergrund: Dunkel</option>
              </select>
              <button id="canvasGridBtn" class="btn btn-sm ${showGrid ? '' : 'btn-oak'}" type="button" title="Punktraster ein/aus">${showGrid ? 'Raster: An' : 'Raster: Aus'}</button>

              <button id="canvasLockBtn" class="btn btn-sm ${state.canvasLocked ? 'btn-oak' : ''}" type="button">
                ${state.canvasLocked ? '🔒 Gesperrt' : '🔓 Frei'}
              </button>
              <button id="canvasSplitBtn" class="btn btn-sm ${state.canvasSplitOpen ? 'btn-primary' : ''}" type="button">
                📋 Planung
              </button>
            </div>
            <div id="canvasPaletteBar" class="canvas-palette-bar">
              <span style="font-size:0.76rem; color:var(--text-muted);">Farbpalette lädt…</span>
            </div>
          </div>

          <div class="canvas-split-layout ${state.canvasSplitOpen ? 'with-split' : ''}">
            <div id="canvasViewport" class="canvas-viewport ${showGrid ? '' : 'no-grid'} ${bgMode === 'white' ? 'bg-white' : (bgMode === 'dark' ? 'bg-dark' : '')}">
              <div id="canvasStage" class="canvas-stage" style="transform: translate(${state.canvasPanX}px, ${state.canvasPanY}px) scale(${state.canvasZoom});">
                ${visualItems.map((item) => {
                  const c = item.canvas;
                  const isSelected = state.selectedCanvasIds.has(item.id);
                  const src = item.localDataUrl || item.previewImageUrl || '';
                  return `
                    <div class="canvas-item ${isSelected ? 'selected' : ''} ${fitMode === 'contain' ? 'fit-contain' : ''}"
                         data-canvas-id="${item.id}"
                         style="left:${c.x}px; top:${c.y}px; width:${c.w}px; height:${c.h}px; z-index:${c.z || 1};">
                      <img src="${escapeHtml(src)}" alt="${escapeHtml(item.title)}" data-drive-img="${item.driveFileId || ''}" />
                      <div class="canvas-item-label">${escapeHtml(item.title || 'Bild')}</div>
                      ${state.canvasLocked ? '' : '<div class="canvas-resize-handle" data-resize-handle="1"></div>'}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
            ${state.canvasSplitOpen ? '<aside id="canvasSplitPanel" class="split-panel"></aside>' : ''}
          </div>
        `;

        const viewport = document.getElementById('canvasViewport');
        const stage = document.getElementById('canvasStage');
        const paletteBar = document.getElementById('canvasPaletteBar');

        function updatePaletteBar() {
          const imgs = [];
          const selectedEls = stage.querySelectorAll('.canvas-item.selected img');
          if (selectedEls.length > 0) selectedEls.forEach((im) => imgs.push(im));
          else stage.querySelectorAll('.canvas-item img').forEach((im) => imgs.push(im));

          const colors = extractColorsFromImages(imgs, 6);
          if (colors.length === 0) {
            paletteBar.innerHTML = '<span style="font-size:0.76rem; color:var(--text-muted);">Farbpalette nur für Drive-/eigene Bilder verfügbar</span>';
            return;
          }
          paletteBar.innerHTML = `
            <span style="font-size:0.75rem; color:var(--text-muted);">${selectedEls.length > 0 ? 'Auswahl-Farben:' : 'Board-Farben:'}</span>
            ${colors.map((hex) => `
              <button class="palette-chip" data-copy-hex="${hex}" type="button" title="Hex-Code kopieren">
                <span class="palette-dot" style="background:${hex};"></span>
                <span>${hex}</span>
              </button>
            `).join('')}
          `;
          paletteBar.querySelectorAll('[data-copy-hex]').forEach((chip) => {
            chip.addEventListener('click', () => {
              const hex = chip.getAttribute('data-copy-hex');
              if (navigator.clipboard) navigator.clipboard.writeText(hex);
              showSyncStatus(`Farbe ${hex} kopiert`, true);
              setTimeout(() => showSyncStatus('', false), 1400);
            });
          });
        }

        // Drive-Bilder CORS-frei nachladen und danach Palette aktualisieren
        let pendingImgs = 0;
        stage.querySelectorAll('img[data-drive-img]').forEach(async (imgEl) => {
          const fileId = imgEl.getAttribute('data-drive-img');
          if (!fileId || state.mode !== 'drive') {
            imgEl.addEventListener('load', updatePaletteBar, { once: true });
            return;
          }
          pendingImgs++;
          try {
            imgEl.src = await DriveAdapter.fetchBlobUrl(fileId);
            imgEl.addEventListener('load', updatePaletteBar, { once: true });
          } catch (e) {
            console.warn(e);
          } finally {
            pendingImgs--;
            if (pendingImgs === 0) setTimeout(updatePaletteBar, 80);
          }
        });
        setTimeout(updatePaletteBar, 120);

        // Toolbar-Buttons
        document.getElementById('canvasZoomInBtn').addEventListener('click', () => {
          state.canvasZoom = Math.min(2.5, +(state.canvasZoom + 0.15).toFixed(2));
          stage.style.transform = `translate(${state.canvasPanX}px, ${state.canvasPanY}px) scale(${state.canvasZoom})`;
          document.getElementById('canvasZoomLabel').textContent = `${Math.round(state.canvasZoom * 100)} %`;
        });
        document.getElementById('canvasZoomOutBtn').addEventListener('click', () => {
          state.canvasZoom = Math.max(0.35, +(state.canvasZoom - 0.15).toFixed(2));
          stage.style.transform = `translate(${state.canvasPanX}px, ${state.canvasPanY}px) scale(${state.canvasZoom})`;
          document.getElementById('canvasZoomLabel').textContent = `${Math.round(state.canvasZoom * 100)} %`;
        });
        document.getElementById('canvasResetViewBtn').addEventListener('click', () => {
          state.canvasZoom = 1; state.canvasPanX = 0; state.canvasPanY = 0;
          stage.style.transform = 'translate(0px, 0px) scale(1)';
          document.getElementById('canvasZoomLabel').textContent = '100 %';
        });
        document.getElementById('canvasAutoLayoutBtn').addEventListener('click', () => {
          // Reihenfolge anhand aktueller visueller Position (Zeilenbänder auf Y, dann X) beibehalten
          const ordered = visualItems.slice().sort((a, b) => {
            const ay = Math.round((a.canvas.y || 0) / 110);
            const by = Math.round((b.canvas.y || 0) / 110);
            if (ay !== by) return ay - by;
            return (a.canvas.x || 0) - (b.canvas.x || 0);
          });
          const gap = 24;
          const cols = 4;
          let curX = 32;
          let curY = 32;
          let rowMaxH = 0;
          ordered.forEach((it, idx) => {
            if (idx > 0 && idx % cols === 0) {
              curX = 32;
              curY += rowMaxH + gap;
              rowMaxH = 0;
            }
            it.canvas.x = curX;
            it.canvas.y = curY;
            curX += (it.canvas.w || 220) + gap;
            rowMaxH = Math.max(rowMaxH, it.canvas.h || 210);
          });
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        });

        function saveCanvasSetting(patch) {
          if (!content.board.canvasSettings) content.board.canvasSettings = {};
          Object.assign(content.board.canvasSettings, patch);
          scheduleBoardSave(folderId);
        }

        document.getElementById('canvasFitBtn').addEventListener('click', () => {
          const next = fitMode === 'contain' ? 'cover' : 'contain';
          state.canvasFitMode = next;
          saveCanvasSetting({ fitMode: next });
          renderCanvasView(container, statsEl, folderId);
        });

        document.getElementById('canvasRatioSelect').addEventListener('change', (e) => {
          const mode = e.target.value;
          if (!mode) return;
          const targets = state.selectedCanvasIds.size > 0
            ? visualItems.filter((it) => state.selectedCanvasIds.has(it.id))
            : visualItems;
          for (const it of targets) {
            if (mode === '1:1') { it.canvas.w = 220; it.canvas.h = 220; }
            else if (mode === '4:3') { it.canvas.w = 240; it.canvas.h = 180; }
            else if (mode === '3:4') { it.canvas.w = 200; it.canvas.h = 266; }
            else if (mode === 'original') {
              const imgEl = stage.querySelector(`.canvas-item[data-canvas-id="${it.id}"] img`);
              if (imgEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
                const ratio = imgEl.naturalHeight / imgEl.naturalWidth;
                it.canvas.w = 230;
                it.canvas.h = Math.max(100, Math.min(420, Math.round(230 * ratio)));
              }
            }
          }
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        });

        document.getElementById('canvasLayerUpBtn').addEventListener('click', () => {
          if (state.selectedCanvasIds.size === 0) return;
          const maxZ = Math.max(1, ...visualItems.map((i) => (i.canvas && i.canvas.z) || 1));
          visualItems.forEach((it) => { if (state.selectedCanvasIds.has(it.id)) it.canvas.z = maxZ + 1; });
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        });

        document.getElementById('canvasLayerDownBtn').addEventListener('click', () => {
          if (state.selectedCanvasIds.size === 0) return;
          const minZ = Math.min(1, ...visualItems.map((i) => (i.canvas && i.canvas.z) || 1));
          visualItems.forEach((it) => { if (state.selectedCanvasIds.has(it.id)) it.canvas.z = Math.max(0, minZ - 1); });
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        });

        document.getElementById('canvasBgSelect').addEventListener('change', (e) => {
          state.canvasBg = e.target.value;
          saveCanvasSetting({ bgMode: e.target.value });
          renderCanvasView(container, statsEl, folderId);
        });

        document.getElementById('canvasGridBtn').addEventListener('click', () => {
          const next = !showGrid;
          state.canvasShowGrid = next;
          saveCanvasSetting({ showGrid: next });
          renderCanvasView(container, statsEl, folderId);
        });
        document.getElementById('canvasLockBtn').addEventListener('click', () => {
          state.canvasLocked = !state.canvasLocked;
          renderCanvasView(container, statsEl, folderId);
        });
        document.getElementById('canvasSplitBtn').addEventListener('click', () => {
          state.canvasSplitOpen = !state.canvasSplitOpen;
          renderCanvasView(container, statsEl, folderId);
        });
        if (state.canvasSplitOpen) {
          const splitEl = document.getElementById('canvasSplitPanel');
          if (splitEl) renderSplitPlanningPanel(splitEl, folderId);
        }

        // Pointer-Interaktion (Drag, Resize, Pan)
        let activeAction = null;

        viewport.addEventListener('pointerdown', (e) => {
          const itemEl = e.target.closest('.canvas-item');
          if (!itemEl) {
            if (!e.shiftKey) {
              state.selectedCanvasIds.clear();
              stage.querySelectorAll('.canvas-item').forEach((el) => el.classList.remove('selected'));
              updatePaletteBar();
            }
            activeAction = {
              type: 'pan',
              startX: e.clientX,
              startY: e.clientY,
              origPanX: state.canvasPanX,
              origPanY: state.canvasPanY
            };
            viewport.setPointerCapture(e.pointerId);
            return;
          }

          const id = itemEl.getAttribute('data-canvas-id');
          const item = visualItems.find((i) => i.id === id);
          if (!item) return;

          if (!e.shiftKey && !state.selectedCanvasIds.has(id)) {
            state.selectedCanvasIds.clear();
            stage.querySelectorAll('.canvas-item').forEach((el) => el.classList.remove('selected'));
          }
          state.selectedCanvasIds.add(id);
          itemEl.classList.add('selected');

          // Nach vorne holen
          const maxZ = Math.max(1, ...visualItems.map((i) => (i.canvas && i.canvas.z) || 1));
          item.canvas.z = maxZ + 1;
          itemEl.style.zIndex = item.canvas.z;
          updatePaletteBar();

          if (state.canvasLocked) return;

          const isResize = e.target.hasAttribute('data-resize-handle');
          activeAction = {
            type: isResize ? 'resize' : 'drag',
            item,
            itemEl,
            startX: e.clientX,
            startY: e.clientY,
            origX: item.canvas.x,
            origY: item.canvas.y,
            origW: item.canvas.w,
            origH: item.canvas.h
          };
          viewport.setPointerCapture(e.pointerId);
        });

        viewport.addEventListener('pointermove', (e) => {
          if (!activeAction) return;
          const dx = (e.clientX - activeAction.startX) / state.canvasZoom;
          const dy = (e.clientY - activeAction.startY) / state.canvasZoom;

          if (activeAction.type === 'pan') {
            state.canvasPanX = activeAction.origPanX + (e.clientX - activeAction.startX);
            state.canvasPanY = activeAction.origPanY + (e.clientY - activeAction.startY);
            stage.style.transform = `translate(${state.canvasPanX}px, ${state.canvasPanY}px) scale(${state.canvasZoom})`;
          } else if (activeAction.type === 'drag') {
            activeAction.item.canvas.x = Math.round(activeAction.origX + dx);
            activeAction.item.canvas.y = Math.round(activeAction.origY + dy);
            activeAction.itemEl.style.left = activeAction.item.canvas.x + 'px';
            activeAction.itemEl.style.top = activeAction.item.canvas.y + 'px';
          } else if (activeAction.type === 'resize') {
            activeAction.item.canvas.w = Math.max(90, Math.round(activeAction.origW + dx));
            activeAction.item.canvas.h = Math.max(90, Math.round(activeAction.origH + dy));
            activeAction.itemEl.style.width = activeAction.item.canvas.w + 'px';
            activeAction.itemEl.style.height = activeAction.item.canvas.h + 'px';
          }
        });

        viewport.addEventListener('pointerup', () => {
          if (activeAction && (activeAction.type === 'drag' || activeAction.type === 'resize')) {
            scheduleBoardSave(folderId);
          }
          activeAction = null;
        });
      }

      /* ========================================================================
         14. PHASE 2: EDITIERBARE PROJEKT-STARTSEITE & PIPETTE
         ======================================================================== */
      function ensureProjectHomeStructure(board, folderName) {
        if (!board.projectHome) board.projectHome = {};
        const h = board.projectHome;
        if (h.eyebrow === undefined) h.eyebrow = 'Projekt-Konzept';
        if (h.title === undefined) h.title = folderName;
        if (h.lead === undefined) h.lead = '';
        if (!Array.isArray(h.swatches)) h.swatches = [];
        if (!Array.isArray(h.zoneRules)) h.zoneRules = [];
        if (!Array.isArray(h.tips)) h.tips = [];
        if (!h.floorplan) h.floorplan = { imageItemId: null, hotspots: [] };
        if (!Array.isArray(h.floorplan.hotspots)) h.floorplan.hotspots = [];
        return h;
      }

      function renderProjectHomeView(container, statsEl, folderId) {
        const content = state.folderContents[folderId];
        const folder = state.folders.find((f) => f.id === folderId);
        const home = ensureProjectHomeStructure(content.board, folder ? folder.name : 'Projekt');
        const subfolders = state.folders.filter((f) => (f.parents || []).includes(folderId));
        const itemsCount = (content.board.items || []).length;
        const todos = content.board.todos || [];
        const doneTodos = todos.filter((t) => t.done).length;
        const edit = state.homeEditMode;

        statsEl.textContent = edit ? 'Bearbeitungs-Modus aktiv' : 'Projekt-Übersicht';

        const imageItems = (content.board.items || []).filter((it) => it.type === 'image' || it.previewImageUrl);
        const floorplanItem = imageItems.find((it) => it.id === home.floorplan.imageItemId) || null;

        container.innerHTML = `
          <div style="display:flex; justify-content:flex-end; gap:8px; margin-bottom:14px; flex-wrap:wrap;">
            <button id="openGeminiImportBtn" class="btn btn-sm" type="button">✨ Von Gemini importieren</button>
            <button id="toggleHomeEditBtn" class="btn btn-sm ${edit ? 'btn-primary' : 'btn-oak'}" type="button">
              ${edit ? '✅ Bearbeitung beenden' : '✏️ Startseite bearbeiten'}
            </button>
          </div>

          <!-- Briefing Header -->
          <section class="home-hero">
            ${edit ? `
              <div class="form-group">
                <label class="form-label">Kategorie / Untertitel (Eyebrow)</label>
                <input id="homeEyebrowInput" class="form-control" type="text" value="${escapeHtml(home.eyebrow)}" />
              </div>
              <div class="form-group">
                <label class="form-label">Projekt-Titel</label>
                <input id="homeTitleInput" class="form-control" type="text" value="${escapeHtml(home.title)}" />
              </div>
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">Leitidee / Kurzbeschreibung</label>
                <textarea id="homeLeadInput" class="form-control" rows="2">${escapeHtml(home.lead)}</textarea>
              </div>
            ` : `
              <div class="home-eyebrow">${escapeHtml(home.eyebrow || 'Projekt-Konzept')}</div>
              <h2 style="margin:0; font-size:1.5rem; letter-spacing:-0.02em;">${escapeHtml(home.title || (folder ? folder.name : 'Projekt'))}</h2>
              <p class="home-lead">${escapeHtml(home.lead || 'Noch keine Leitidee hinterlegt. Klicke oben rechts auf „Startseite bearbeiten“ oder importiere einen Entwurf von Gemini.')}</p>
              <div class="home-badges">
                <span class="meta-pill">📁 ${subfolders.length} Unterbereiche</span>
                <span class="meta-pill">🖼️ ${itemsCount} Elemente</span>
                <span class="meta-pill">☑️ ${doneTodos}/${todos.length} To-dos</span>
              </div>
            `}
          </section>

          <!-- Farb- & Material-Swatches -->
          <section class="home-section">
            <div class="home-section-head">
              <h3 class="home-section-title">Farb- &amp; Material-Swatches</h3>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button id="openEyedropperBtn" class="btn btn-sm" type="button">💧 Farbe aus Bild aufnehmen</button>
                <button id="addSwatchBtn" class="btn btn-sm btn-oak" type="button">＋ Swatch</button>
              </div>
            </div>
            ${home.swatches.length === 0
              ? '<p style="color:var(--text-muted); font-size:0.88rem; margin:0;">Noch keine Swatches angelegt. Nimm per Pipette Farben aus deinen Projektbildern auf oder füge manuell Materialien hinzu.</p>'
              : `<div class="swatch-grid">
                  ${home.swatches.map((sw, idx) => `
                    <div class="swatch-card" data-swatch-idx="${idx}">
                      <div class="swatch-color-bar" style="background:${escapeHtml(sw.hex || '#C59B6D')};"></div>
                      ${edit ? `
                        <input class="form-control" data-sw-field="name" value="${escapeHtml(sw.name)}" placeholder="Name (z. B. Eiche geölt)" />
                        <div style="display:flex; gap:6px;">
                          <input type="color" data-sw-field="hex" value="${escapeHtml(sw.hex || '#C59B6D')}" style="width:42px; height:36px; border:1px solid var(--border-color); border-radius:6px; background:none; cursor:pointer;" />
                          <input class="form-control" data-sw-field="material" value="${escapeHtml(sw.material || '')}" placeholder="Material" />
                        </div>
                        <input class="form-control" data-sw-field="note" value="${escapeHtml(sw.note || '')}" placeholder="Haptik / Hinweis" />
                        <button class="btn btn-sm" data-del-swatch="${idx}" type="button" style="color:var(--danger);">Entfernen</button>
                      ` : `
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                          <strong style="font-size:0.92rem;">${escapeHtml(sw.name || 'Material')}</strong>
                          <code style="font-size:0.74rem; color:var(--text-muted);">${escapeHtml(sw.hex || '')}</code>
                        </div>
                        ${sw.material ? `<span style="font-size:0.78rem; color:var(--accent-oak); font-weight:600;">${escapeHtml(sw.material)}</span>` : ''}
                        ${sw.note ? `<span style="font-size:0.8rem; color:var(--text-secondary);">${escapeHtml(sw.note)}</span>` : ''}
                      `}
                    </div>
                  `).join('')}
                </div>`
            }
          </section>

          <!-- Bereichs-Explorer (Unterordner) + Gestaltungsregeln + Grundriss-Hotspots -->
          <section class="home-section">
            <div class="home-section-head">
              <h3 class="home-section-title">Bereiche, Gestaltungsregeln &amp; Stellplan</h3>
            </div>

            ${subfolders.length > 0 ? `
              <div style="margin-bottom:14px;">
                <div style="font-size:0.78rem; color:var(--text-muted); margin-bottom:6px;">Unterbereiche dieses Projekts (klicken zum Öffnen):</div>
                <div class="zone-tabs">
                  ${subfolders.map((sf) => `
                    <button class="btn btn-sm" data-jump-folder="${sf.id}" type="button">📁 ${escapeHtml(sf.name)}</button>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:20px; align-items:start;">
              <div>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                  <strong style="font-size:0.9rem;">Gestaltungsregeln</strong>
                  ${edit ? '<button id="addRuleBtn" class="btn btn-sm" type="button">＋ Regel</button>' : ''}
                </div>
                ${home.zoneRules.length === 0
                  ? '<p style="font-size:0.84rem; color:var(--text-muted); margin:0;">Noch keine Regeln definiert.</p>'
                  : `<ul style="margin:0; padding-left:18px; display:flex; flex-direction:column; gap:6px;">
                      ${home.zoneRules.map((rule, idx) => edit
                        ? `<li style="list-style:none; margin-left:-18px; display:flex; gap:6px;">
                             <input class="form-control" data-rule-idx="${idx}" value="${escapeHtml(rule)}" />
                             <button class="btn-icon" data-del-rule="${idx}" type="button" title="Löschen">✕</button>
                           </li>`
                        : `<li style="font-size:0.88rem; color:var(--text-secondary);">${escapeHtml(rule)}</li>`
                      ).join('')}
                    </ul>`
                }
              </div>

              <div>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; gap:8px; flex-wrap:wrap;">
                  <strong style="font-size:0.9rem;">Grundriss / Stellplan mit Hotspots</strong>
                  ${edit ? `
                    <select id="floorplanImageSelect" class="form-control" style="max-width:220px; padding:4px 8px; font-size:0.8rem;">
                      <option value="">— Kein Grundriss —</option>
                      ${imageItems.map((it) => `<option value="${it.id}" ${home.floorplan.imageItemId === it.id ? 'selected' : ''}>${escapeHtml(it.title)}</option>`).join('')}
                    </select>
                  ` : ''}
                </div>
                ${floorplanItem ? `
                  <div id="floorplanWrap" class="floorplan-wrap">
                    <img id="floorplanImg" src="${escapeHtml(floorplanItem.localDataUrl || floorplanItem.previewImageUrl || '')}" data-drive-img="${floorplanItem.driveFileId || ''}" alt="Grundriss" />
                    ${home.floorplan.hotspots.map((hp, idx) => `
                      <button class="hotspot-pin" data-hotspot-idx="${idx}" style="left:${hp.x}%; top:${hp.y}%;" type="button" title="${escapeHtml(hp.label)}">${idx + 1}</button>
                    `).join('')}
                  </div>
                  <div id="hotspotInfoBox" style="margin-top:8px; font-size:0.82rem; color:var(--text-secondary);">
                    ${edit ? 'Tipp: Im Bearbeitungs-Modus direkt auf den Plan klicken, um einen Pin zu setzen.' : 'Pin anklicken, um Maße/Notiz zu sehen.'}
                  </div>
                ` : '<p style="font-size:0.84rem; color:var(--text-muted); margin:0;">Optional: Lade ein Grundriss- oder Zonen-Foto hoch und wähle es im Bearbeitungs-Modus hier als Stellplan aus.</p>'}
              </div>
            </div>
          </section>

          <!-- Praxishinweise -->
          <section class="home-section">
            <div class="home-section-head">
              <h3 class="home-section-title">Praxishinweise &amp; Merksätze</h3>
              ${edit ? '<button id="addTipBtn" class="btn btn-sm" type="button">＋ Hinweis</button>' : ''}
            </div>
            ${home.tips.length === 0
              ? '<p style="font-size:0.84rem; color:var(--text-muted); margin:0;">Noch keine Praxishinweise hinterlegt.</p>'
              : `<div class="tips-grid">
                  ${home.tips.map((tip, idx) => `
                    <div class="tip-card" data-tip-idx="${idx}">
                      ${edit ? `
                        <input class="form-control" data-tip-field="title" value="${escapeHtml(tip.title)}" placeholder="Titel" style="margin-bottom:6px;" />
                        <textarea class="form-control" data-tip-field="text" rows="2" placeholder="Beschreibung">${escapeHtml(tip.text)}</textarea>
                        <button class="btn btn-sm" data-del-tip="${idx}" type="button" style="margin-top:6px; color:var(--danger);">Entfernen</button>
                      ` : `
                        <h4 style="margin:0 0 4px; font-size:0.92rem;">${escapeHtml(tip.title)}</h4>
                        <p style="margin:0; font-size:0.83rem; color:var(--text-secondary);">${escapeHtml(tip.text)}</p>
                      `}
                    </div>
                  `).join('')}
                </div>`
            }
          </section>
        `;

        // Drive-Bild für Grundriss nachladen
        container.querySelectorAll('img[data-drive-img]').forEach(async (imgEl) => {
          const fId = imgEl.getAttribute('data-drive-img');
          if (!fId || state.mode !== 'drive') return;
          try { imgEl.src = await DriveAdapter.fetchBlobUrl(fId); } catch (e) { console.warn(e); }
        });

        // Events: Bearbeiten-Modus, Gemini-Import, Pipette
        document.getElementById('toggleHomeEditBtn').addEventListener('click', () => {
          state.homeEditMode = !state.homeEditMode;
          renderProjectHomeView(container, statsEl, folderId);
        });

        document.getElementById('openGeminiImportBtn').addEventListener('click', () => openModal('geminiImportModal'));
        document.getElementById('openEyedropperBtn').addEventListener('click', () => openEyedropperModal(folderId));

        document.getElementById('addSwatchBtn').addEventListener('click', () => {
          home.swatches.push({ id: uid('sw'), name: 'Neues Material', hex: '#C59B6D', material: '', note: '' });
          state.homeEditMode = true;
          scheduleBoardSave(folderId);
          renderProjectHomeView(container, statsEl, folderId);
        });

        container.querySelectorAll('[data-jump-folder]').forEach((btn) => {
          btn.addEventListener('click', () => openFolder(btn.getAttribute('data-jump-folder')));
        });

        if (edit) {
          document.getElementById('homeEyebrowInput').addEventListener('input', (e) => { home.eyebrow = e.target.value; scheduleBoardSave(folderId); });
          document.getElementById('homeTitleInput').addEventListener('input', (e) => { home.title = e.target.value; scheduleBoardSave(folderId); });
          document.getElementById('homeLeadInput').addEventListener('input', (e) => { home.lead = e.target.value; scheduleBoardSave(folderId); });

          container.querySelectorAll('[data-sw-field]').forEach((inp) => {
            inp.addEventListener('input', () => {
              const idx = Number(inp.closest('[data-swatch-idx]').getAttribute('data-swatch-idx'));
              const field = inp.getAttribute('data-sw-field');
              home.swatches[idx][field] = inp.value;
              if (field === 'hex') inp.closest('.swatch-card').querySelector('.swatch-color-bar').style.background = inp.value;
              scheduleBoardSave(folderId);
            });
          });
          container.querySelectorAll('[data-del-swatch]').forEach((btn) => {
            btn.addEventListener('click', () => {
              home.swatches.splice(Number(btn.getAttribute('data-del-swatch')), 1);
              scheduleBoardSave(folderId);
              renderProjectHomeView(container, statsEl, folderId);
            });
          });

          const addRuleBtn = document.getElementById('addRuleBtn');
          if (addRuleBtn) {
            addRuleBtn.addEventListener('click', () => {
              home.zoneRules.push('Neue Gestaltungsregel');
              scheduleBoardSave(folderId);
              renderProjectHomeView(container, statsEl, folderId);
            });
          }
          container.querySelectorAll('[data-rule-idx]').forEach((inp) => {
            inp.addEventListener('input', () => {
              home.zoneRules[Number(inp.getAttribute('data-rule-idx'))] = inp.value;
              scheduleBoardSave(folderId);
            });
          });
          container.querySelectorAll('[data-del-rule]').forEach((btn) => {
            btn.addEventListener('click', () => {
              home.zoneRules.splice(Number(btn.getAttribute('data-del-rule')), 1);
              scheduleBoardSave(folderId);
              renderProjectHomeView(container, statsEl, folderId);
            });
          });

          const fpSelect = document.getElementById('floorplanImageSelect');
          if (fpSelect) {
            fpSelect.addEventListener('change', () => {
              home.floorplan.imageItemId = fpSelect.value || null;
              scheduleBoardSave(folderId);
              renderProjectHomeView(container, statsEl, folderId);
            });
          }

          const addTipBtn = document.getElementById('addTipBtn');
          if (addTipBtn) {
            addTipBtn.addEventListener('click', () => {
              home.tips.push({ title: 'Neuer Hinweis', text: '' });
              scheduleBoardSave(folderId);
              renderProjectHomeView(container, statsEl, folderId);
            });
          }
          container.querySelectorAll('[data-tip-field]').forEach((inp) => {
            inp.addEventListener('input', () => {
              const idx = Number(inp.closest('[data-tip-idx]').getAttribute('data-tip-idx'));
              home.tips[idx][inp.getAttribute('data-tip-field')] = inp.value;
              scheduleBoardSave(folderId);
            });
          });
          container.querySelectorAll('[data-del-tip]').forEach((btn) => {
            btn.addEventListener('click', () => {
              home.tips.splice(Number(btn.getAttribute('data-del-tip')), 1);
              scheduleBoardSave(folderId);
              renderProjectHomeView(container, statsEl, folderId);
            });
          });
        }

        // Grundriss-Hotspots (klicken zum Ansehen oder im Edit-Modus neu setzen)
        const fpImg = document.getElementById('floorplanImg');
        if (fpImg && edit) {
          fpImg.addEventListener('click', async (e) => {
            const rect = fpImg.getBoundingClientRect();
            const x = +(((e.clientX - rect.left) / rect.width) * 100).toFixed(1);
            const y = +(((e.clientY - rect.top) / rect.height) * 100).toFixed(1);
            const res = await uiPromptForm('Grundriss-Pin setzen', [
              { key: 'label', label: 'Bezeichnung', placeholder: 'z. B. Esstisch 300x100 cm', required: true },
              { key: 'note', label: 'Maß / Notiz (optional)', placeholder: 'z. B. Abstand zur Wand 80 cm' }
            ]);
            if (!res || !res.label.trim()) return;
            home.floorplan.hotspots.push({ x, y, label: res.label.trim(), note: (res.note || '').trim() });
            scheduleBoardSave(folderId);
            renderProjectHomeView(container, statsEl, folderId);
          });
        }
        container.querySelectorAll('[data-hotspot-idx]').forEach((pin) => {
          pin.addEventListener('click', async (e) => {
            e.stopPropagation();
            const idx = Number(pin.getAttribute('data-hotspot-idx'));
            const hp = home.floorplan.hotspots[idx];
            const infoBox = document.getElementById('hotspotInfoBox');
            if (edit) {
              if (await uiConfirm(`Pin #${idx + 1} (${hp.label}) löschen?`, 'Pin löschen', 'Löschen')) {
                home.floorplan.hotspots.splice(idx, 1);
                scheduleBoardSave(folderId);
                renderProjectHomeView(container, statsEl, folderId);
              }
            } else if (infoBox) {
              infoBox.innerHTML = `<strong>#${idx + 1} ${escapeHtml(hp.label)}</strong>${hp.note ? ' — ' + escapeHtml(hp.note) : ''}`;
            }
          });
        });
      }

      /* ========================================================================
         15. PIPETTEN-MODAL & GEMINI-JSON-IMPORT
         ======================================================================== */
      async function openEyedropperModal(folderId) {
        const content = state.folderContents[folderId];
        const images = (content.board.items || []).filter((it) => it.type === 'image');
        if (images.length === 0) {
          await uiAlert('Bitte lade zuerst mindestens ein eigenes Bild in diesen Ordner hoch, um Farben per Pipette aufzunehmen.');
          return;
        }
        const select = document.getElementById('eyedropperImageSelect');
        select.innerHTML = images.map((im) => `<option value="${im.id}">${escapeHtml(im.title || 'Bild')}</option>`).join('');

        async function drawSelected() {
          const item = images.find((im) => im.id === select.value);
          if (!item) return;
          const src = item.localDataUrl || (item.driveFileId && state.mode === 'drive' ? await DriveAdapter.fetchBlobUrl(item.driveFileId) : '');
          if (!src) return;
          const img = new Image();
          img.onload = () => {
            const canvas = document.getElementById('eyedropperCanvas');
            const scale = Math.min(1, 580 / img.width);
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          };
          img.src = src;
        }

        select.onchange = drawSelected;
        openModal('eyedropperModal');
        await drawSelected();
      }

      document.getElementById('eyedropperCanvas').addEventListener('click', (e) => {
        const canvas = e.target;
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width);
        const y = Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height);
        const pixel = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
        const hex = '#' + [pixel[0], pixel[1], pixel[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
        state.eyedropperPickedHex = hex;
        document.getElementById('eyedropperPreview').style.background = hex;
        document.getElementById('eyedropperHex').textContent = hex;
      });

      document.getElementById('eyedropperApplyBtn').addEventListener('click', async () => {
        const content = state.folderContents[state.activeFolderId];
        if (!content) return;
        const home = ensureProjectHomeStructure(content.board, '');
        const res = await uiPromptForm('Farbe als Swatch speichern', [
          { key: 'name', label: 'Name für diese Farbe / Material', value: `Farbe ${state.eyedropperPickedHex}`, required: true }
        ]);
        if (!res || !res.name.trim()) return;
        home.swatches.push({ id: uid('sw'), name: res.name.trim(), hex: state.eyedropperPickedHex, material: '', note: 'Per Pipette aufgenommen' });
        scheduleBoardSave(state.activeFolderId);
        closeModal('eyedropperModal');
        if (state.activeView === 'home') renderMainView();
      });

      document.getElementById('copyGeminiPromptBtn').addEventListener('click', () => {
        const promptText = `Erstelle mir ein Projekt-Grundgerüst als reines JSON (ohne Markdown-Erklärung) für folgendes Projekt: [THEMA].\nFormat:\n{\n  "eyebrow": "Stil · Anlass",\n  "title": "Projekttitel",\n  "lead": "Kurze Leitidee",\n  "swatches": [{ "name": "Material", "hex": "#C59B6D", "material": "Holz", "note": "Haptik" }],\n  "zoneRules": ["Regel 1", "Regel 2"],\n  "tips": [{ "title": "Praxistipp", "text": "Details" }],\n  "todos": [{ "text": "Aufgabe 1", "category": "Vorbereitung" }]\n}`;
        if (navigator.clipboard) navigator.clipboard.writeText(promptText);
        showSyncStatus('Beispiel-Prompt für Gemini kopiert!', true);
        setTimeout(() => showSyncStatus('', false), 1800);
      });

      document.getElementById('applyGeminiImportBtn').addEventListener('click', () => {
        const raw = document.getElementById('geminiJsonInput').value.trim();
        if (!raw) return;
        try {
          const clean = raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
          const data = JSON.parse(clean);
          const content = state.folderContents[state.activeFolderId];
          const home = ensureProjectHomeStructure(content.board, '');
          if (data.eyebrow) home.eyebrow = data.eyebrow;
          if (data.title) home.title = data.title;
          if (data.lead) home.lead = data.lead;
          if (Array.isArray(data.swatches)) {
            home.swatches = data.swatches.map((s) => ({ id: uid('sw'), name: s.name || '', hex: s.hex || '#C59B6D', material: s.material || '', note: s.note || '' }));
          }
          if (Array.isArray(data.zoneRules)) home.zoneRules = data.zoneRules;
          if (Array.isArray(data.tips)) home.tips = data.tips;
          if (Array.isArray(data.todos)) {
            const newTodos = data.todos.map((t) => ({ id: uid('t'), text: t.text || String(t), done: false, category: t.category || 'Allgemein' }));
            content.board.todos = [...(content.board.todos || []), ...newTodos];
          }
          scheduleBoardSave(state.activeFolderId);
          closeModal('geminiImportModal');
          renderMainView();
        } catch (err) {
          uiAlert('Ungültiges JSON: ' + err.message, 'Fehler');
        }
      });
