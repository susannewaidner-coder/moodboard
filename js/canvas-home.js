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

      function bindHexColorPair(colorInp, hexInp, onApply) {
        if (!colorInp || !hexInp) return;
        colorInp.addEventListener('input', () => {
          hexInp.value = colorInp.value.toUpperCase();
          onApply(colorInp.value);
        });
        hexInp.addEventListener('input', () => {
          let v = hexInp.value.trim();
          if (v && !v.startsWith('#')) v = '#' + v;
          if (/^#[0-9a-fA-F]{6}$/.test(v)) {
            colorInp.value = v;
            onApply(v);
          }
        });
      }

      function getCanvasUndoStack(folderId) {
        if (!state.canvasUndoStacks) state.canvasUndoStacks = {};
        if (!state.canvasUndoStacks[folderId]) state.canvasUndoStacks[folderId] = [];
        return state.canvasUndoStacks[folderId];
      }

      function pushCanvasUndo(folderId) {
        const content = state.folderContents[folderId];
        if (!content) return;
        const stack = getCanvasUndoStack(folderId);
        stack.push({
          items: (content.board.items || []).map((it) => ({
            id: it.id,
            canvasHidden: !!it.canvasHidden,
            canvas: it.canvas ? JSON.parse(JSON.stringify(it.canvas)) : null
          })),
          canvasElements: JSON.parse(JSON.stringify(content.board.canvasElements || []))
        });
        if (stack.length > 25) stack.shift();
      }

      function undoCanvasAction(folderId) {
        const stack = getCanvasUndoStack(folderId);
        const content = state.folderContents[folderId];
        if (!content || stack.length === 0) return false;
        const snap = stack.pop();
        const snapMap = new Map(snap.items.map((x) => [x.id, x]));
        for (const it of (content.board.items || [])) {
          const s = snapMap.get(it.id);
          if (s) {
            it.canvasHidden = s.canvasHidden;
            it.canvas = s.canvas;
          }
        }
        content.board.canvasElements = snap.canvasElements;
        state.selectedCanvasIds.clear();
        scheduleBoardSave(folderId);
        return true;
      }

      function renderCanvasView(container, statsEl, folderId) {
        const oldVp = document.getElementById('canvasViewport');
        const savedVpScroll = oldVp ? { left: oldVp.scrollLeft, top: oldVp.scrollTop } : null;
        const savedWinY = window.scrollY;
        const content = state.folderContents[folderId];
        if (!Array.isArray(content.board.canvasElements)) content.board.canvasElements = [];
        const allItems = content.board.items || [];
        const visualItems = allItems.filter((it) => !it.canvasHidden);
        const hiddenItems = allItems.filter((it) => !!it.canvasHidden);
        const canvasElements = content.board.canvasElements;
        statsEl.textContent = `${visualItems.length} Elemente · ${canvasElements.length} Gestaltungselemente`;

        // Initiale Positionen vergeben, falls noch keine Canvas-Koordinaten existieren
        let changed = false;
        visualItems.forEach((item, idx) => {
          if (!item.canvas) {
            const col = idx % 4;
            const row = Math.floor(idx / 4);
            item.canvas = { x: 40 + col * 250, y: 40 + row * 240, w: 220, h: 210, z: idx + 1, _needsAutoAspect: true };
            changed = true;
          }
        });
        if (changed) scheduleBoardSave(folderId);
        const undoCount = getCanvasUndoStack(folderId).length;

        const cs = content.board.canvasSettings || {};
        const fitMode = cs.fitMode || state.canvasFitMode;
        const bgMode = cs.bgMode || state.canvasBg;
        const bgColor = cs.bgColor || '';
        const collageMode = !!cs.collageMode;
        const snapToGrid = !!cs.snapToGrid;
        const showGrid = collageMode ? false : (cs.showGrid !== undefined ? cs.showGrid : state.canvasShowGrid);

        const allBoxes = [
          ...visualItems.map((it) => it.canvas),
          ...canvasElements
        ];
        const maxRight = Math.max(2000, ...allBoxes.map((c) => (c.x || 0) + (c.w || 220) + 400));
        const maxBottom = Math.max(1400, ...allBoxes.map((c) => (c.y || 0) + (c.h || 210) + 400));

        const selectedList = [
          ...visualItems.filter((it) => state.selectedCanvasIds.has(it.id)).map((it) => ({ kind: 'item', obj: it, box: it.canvas })),
          ...canvasElements.filter((el) => state.selectedCanvasIds.has(el.id)).map((el) => ({ kind: 'el', obj: el, box: el }))
        ];
        const firstSel = selectedList[0] || null;

        container.innerHTML = `
          <div id="canvasViewWrap" class="canvas-view-wrap ${state.canvasFullscreen ? 'fullscreen' : ''}">
          <div class="canvas-toolbar">
            <div class="canvas-toolbar-group">
              <div class="canvas-options-wrap">
                <button id="canvasAddMenuBtn" class="btn btn-oak btn-sm" type="button">＋ Hinzufügen ▾</button>
                <div id="canvasAddMenuPopover" class="canvas-options-popover hidden" style="min-width:190px; padding:6px;">
                  <button id="canvasAddImageBtn" class="tree-menu-item" type="button">🖼️ Bild hochladen</button>
                  <button id="canvasAddBookmarkBtn" class="tree-menu-item" type="button">🔗 Web-Bookmark</button>
                  <button id="canvasAddFromInvBtn" class="tree-menu-item" type="button">📦 Aus Inventory</button>
                  <button id="canvasAddTextBtn" class="tree-menu-item" type="button">🔤 Text / Badge</button>
                  <button id="canvasAddPaletteBtn" class="tree-menu-item" type="button">🎨 Farbpalette</button>
                  <button id="canvasShowAllHiddenBtn" class="tree-menu-item" type="button" ${hiddenItems.length === 0 ? 'disabled style="opacity:0.45;"' : ''}>👁️ Alle Projekt-Elemente (${hiddenItems.length})</button>
                </div>
              </div>

              <button id="canvasUndoBtn" class="btn btn-sm" type="button" ${undoCount === 0 ? 'disabled' : ''} title="Letzte Änderung rückgängig machen (Strg+Z)">↩️</button>
              <button id="canvasLockBtn" class="btn btn-sm ${state.canvasLocked ? 'btn-oak' : ''}" type="button" title="Verschieben sperren/entsperren">
                ${state.canvasLocked ? '🔒 Gesperrt' : '🔓 Frei'}
              </button>

              <div class="pill-group" style="padding:2px;">
                <button id="canvasZoomOutBtn" class="pill-btn" type="button" title="Verkleinern">－</button>
                <button id="canvasResetViewBtn" class="pill-btn" type="button" title="Zoom auf 100 % zurücksetzen und nach oben links scrollen" style="font-size:0.76rem; padding:0 6px;">${Math.round(state.canvasZoom * 100)} %</button>
                <button id="canvasZoomInBtn" class="pill-btn" type="button" title="Vergrößern">＋</button>
              </div>

              <div class="canvas-options-wrap">
                <button id="canvasOptionsBtn" class="btn btn-sm" type="button">⚙️ Board ▾</button>
                <div id="canvasOptionsPopover" class="canvas-options-popover hidden">
                  <div>
                    <div style="font-size:0.74rem; font-weight:600; color:var(--text-muted); margin-bottom:4px;">Hintergrundfarbe</div>
                    <div style="display:flex; gap:5px; align-items:center; margin-bottom:6px; flex-wrap:wrap;">
                      <button class="btn btn-sm" data-bg-preset="" type="button" title="Standard" style="padding:2px 6px;">Std</button>
                      <button class="btn btn-sm" data-bg-preset="#FFFFFF" type="button" title="Weiß" style="width:24px; height:24px; padding:0; background:#FFFFFF;"></button>
                      <button class="btn btn-sm" data-bg-preset="#DCE4F2" type="button" title="Eisblau" style="width:24px; height:24px; padding:0; background:#DCE4F2;"></button>
                      <button class="btn btn-sm" data-bg-preset="#F6F2EA" type="button" title="Creme" style="width:24px; height:24px; padding:0; background:#F6F2EA;"></button>
                      <button class="btn btn-sm" data-bg-preset="#E3EAE3" type="button" title="Salbei" style="width:24px; height:24px; padding:0; background:#E3EAE3;"></button>
                      <button class="btn btn-sm" data-bg-preset="#1C201E" type="button" title="Dunkel" style="width:24px; height:24px; padding:0; background:#1C201E;"></button>
                      <div class="hex-color-pair">
                        <input id="canvasBgColorInput" type="color" value="${escapeHtml(bgColor || '#F8F7F4')}" title="Eigene Hintergrundfarbe" />
                        <input id="canvasBgColorHex" class="form-control hex-input" type="text" maxlength="7" value="${escapeHtml((bgColor || '#F8F7F4').toUpperCase())}" placeholder="#F8F7F4" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <div style="font-size:0.74rem; font-weight:600; color:var(--text-muted); margin-bottom:4px;">Raster &amp; Ausrichtung</div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
                      <button id="canvasGridBtn" class="btn btn-sm ${showGrid ? '' : 'btn-oak'}" type="button" style="flex:1;">${showGrid ? 'Raster: An' : 'Raster: Aus'}</button>
                      <button id="canvasSnapBtn" class="btn btn-sm ${snapToGrid ? 'btn-oak' : ''}" type="button" style="flex:1;" title="Beim Verschieben und Skalieren am 12px-Raster einrasten">${snapToGrid ? '🧲 Snap: An' : '🧲 Snap: Aus'}</button>
                    </div>
                    <button id="canvasAutoLayoutBtn" class="btn btn-sm" type="button" style="width:100%;" title="Richtet alle Kacheln sauber im Raster an">📐 Alle Kacheln neu anordnen</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="canvas-toolbar-group">
              <div id="canvasPaletteBar" class="canvas-palette-bar">
                <span style="font-size:0.76rem; color:var(--text-muted);">Farben…</span>
              </div>
              <button id="canvasAiLayoutBtn" class="btn btn-sm" type="button" title="KI-Layout-Vorschlag im Editorial-/Collage-Stil erstellen">✨ KI-Layout</button>
              <button id="canvasCollageBtn" class="btn btn-sm ${collageMode ? 'btn-oak' : ''}" type="button" title="Blendet Titel, Links und Raster für den sauberen Collage-Look aus">✨ Collage</button>
              <button id="canvasExportPngBtn" class="btn btn-sm" type="button" title="Moodboard als PNG-Bild herunterladen">📸 PNG</button>
              <button id="canvasSplitBtn" class="btn btn-sm ${state.canvasSplitOpen ? 'btn-primary' : ''}" type="button">📋 Planung</button>
              <button id="canvasFullscreenBtn" class="btn btn-sm ${state.canvasFullscreen ? 'btn-primary' : ''}" type="button" title="Moodboard auf ganzes Browserfenster vergrößern">
                ${state.canvasFullscreen ? '✕ Vollbild' : '⛶ Vollbild'}
              </button>
            </div>
          </div>

          <div id="canvasSelectionBar" class="canvas-selection-bar">
            <span class="sel-group">
              <button class="btn btn-sm" id="canvasSelectAllBtn" type="button" title="Alle Elemente auf dem Board auswählen (Strg+A)">☑️ Alle</button>
              ${selectedList.length > 0 ? `<button class="btn btn-sm" id="canvasDeselectAllBtn" type="button" title="Auswahl aufheben">✕ (${selectedList.length})</button>` : ''}
            </span>
            ${selectedList.length > 0 ? `
              ${firstSel && firstSel.kind === 'item' ? (() => {
                const fc = firstSel.box;
                const fCol = fc.frameColor || (fc.frame === 'white' ? '#FFFFFF' : '');
                const fWidth = Math.max(1, Number(fc.frameWidth) || 6);
                const hasShadow = fc.shadow !== false;
                const selFit = fc.fitMode || fitMode;
                return `
                  <span class="sel-group" title="Form &amp; Format">
                    <button class="btn btn-sm ${(!fc.shape || fc.shape === 'rect') ? 'btn-oak' : ''}" data-sel-shape="rect" type="button" title="Rechteck">▭</button>
                    <button class="btn btn-sm ${fc.shape === 'rounded' ? 'btn-oak' : ''}" data-sel-shape="rounded" type="button" title="Abgerundet">▢</button>
                    <button class="btn btn-sm ${fc.shape === 'circle' ? 'btn-oak' : ''}" data-sel-shape="circle" type="button" title="Kreis">◯</button>
                    <select id="canvasRatioSelect" class="form-control" style="padding:3px 6px; font-size:0.78rem; width:auto;" title="Seitenverhältnis">
                      <option value="">Format…</option>
                      <option value="original">Original</option>
                      <option value="1:1">1:1</option>
                      <option value="4:3">4:3</option>
                      <option value="3:4">3:4</option>
                    </select>
                    <button id="canvasFitBtn" class="btn btn-sm ${selFit === 'contain' ? 'btn-oak' : ''}" type="button" title="Bilddarstellung umschalten: Kachel ausfüllen vs. Ganzes Bild">
                      ${selFit === 'contain' ? '🖼️ Ganz' : '✂️ Füllen'}
                    </button>
                    <button id="selRemoveBgBtn" class="btn btn-sm ${fc.removeWhiteBg ? 'btn-oak' : ''}" type="button" title="Weißen Hintergrund transparent freistellen">🪄 Freistellen</button>
                    ${fc.removeWhiteBg ? `<input id="selBgTolerance" type="range" min="1" max="60" value="${fc.bgTolerance ?? 8}" style="width:56px;" title="Weiß-Toleranz: ${fc.bgTolerance ?? 8}" />` : ''}
                  </span>
                  <span class="sel-group" title="Rahmen &amp; Schatten">
                    <button class="btn btn-sm ${fCol ? 'btn-oak' : ''}" id="selFrameToggleBtn" type="button">⬜ Rand</button>
                    <div class="hex-color-pair">
                      <input id="selFrameColorInput" type="color" value="${escapeHtml(fCol || '#FFFFFF')}" title="Randfarbe" />
                      <input id="selFrameColorHex" class="form-control hex-input" type="text" maxlength="7" value="${escapeHtml((fCol || '#FFFFFF').toUpperCase())}" placeholder="#FFFFFF" />
                      <input id="selFrameWidthInput" class="form-control" type="number" min="1" max="24" value="${fWidth}" title="Randbreite (px)" style="width:46px; padding:3px 5px; font-size:0.78rem;" />
                    </div>
                    <button class="btn btn-sm ${hasShadow ? 'btn-oak' : ''}" id="selShadowToggleBtn" type="button" title="Schatten ein-/ausschalten">🌑</button>
                  </span>
                  <span class="sel-group" title="Bildausschnitt (X / Y / Zoom)">
                    <span>🔍</span>
                    <input id="selCropX" type="range" min="0" max="100" value="${fc.cropX ?? 50}" style="width:44px;" title="Ausschnitt Links/Rechts" />
                    <input id="selCropY" type="range" min="0" max="100" value="${fc.cropY ?? 50}" style="width:44px;" title="Ausschnitt Oben/Unten" />
                    <input id="selCropZoom" type="range" min="1" max="2.5" step="0.05" value="${fc.cropZoom || 1}" style="width:48px;" title="Ausschnitt Zoom" />
                  </span>
                `;
              })() : ''}
              ${firstSel && firstSel.kind === 'el' ? `
                <span class="sel-group">
                  <button class="btn btn-sm" id="selEditElBtn" type="button">✏️ Bearbeiten</button>
                </span>
              ` : ''}
              <span class="sel-group">
                <button class="btn btn-sm" id="canvasLayerUpBtn" type="button" title="Eine Ebene nach vorne">⬆️</button>
                <button class="btn btn-sm" id="canvasLayerDownBtn" type="button" title="Eine Ebene nach hinten">⬇️</button>
                ${firstSel && firstSel.kind === 'item' ? '<button class="btn btn-sm" id="selResetBtn" type="button" title="Form, Rand, Schatten, Ausschnitt &amp; Format zurücksetzen">↺</button>' : ''}
                <button class="btn btn-sm" id="selRemoveCanvasBtn" type="button" style="color:var(--danger);" title="Vom Moodboard entfernen">🗑</button>
              </span>
            ` : `<span style="color:var(--text-muted);">Klicke auf ein Element auf dem Board, um Form, Rand, Ausschnitt oder Ebene anzupassen…</span>`}
          </div>

          <div class="canvas-split-layout ${state.canvasSplitOpen ? 'with-split' : ''}">
            <div id="canvasViewport" class="canvas-viewport ${showGrid ? '' : 'no-grid'} ${collageMode ? 'collage-mode' : ''} ${!bgColor && bgMode === 'white' ? 'bg-white' : (!bgColor && bgMode === 'dark' ? 'bg-dark' : '')}" style="${bgColor ? `background-color:${escapeHtml(bgColor)};` : ''}">
              <div id="canvasStage" class="canvas-stage" style="width:${Math.round(maxRight * state.canvasZoom)}px; height:${Math.round(maxBottom * state.canvasZoom)}px; transform: scale(${state.canvasZoom});">
                ${(visualItems.length === 0 && canvasElements.length === 0) ? `
                  <div class="phase-placeholder" style="position:absolute; left:40px; top:40px; max-width:520px; z-index:5;">
                    <h3 style="margin-top:0; color:var(--text-primary);">Dieses Moodboard ist aktuell leer</h3>
                    <p>Nutze oben <strong>＋ Hinzufügen</strong>, mache mit <strong>↩️</strong> den letzten Schritt rückgängig oder hole ausgeblendete Projekt-Elemente wieder aufs Board:</p>
                    <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap; margin-top:12px;">
                      ${hiddenItems.length > 0 ? `<button id="emptyCanvasRestoreAllBtn" class="btn btn-oak btn-sm" type="button">👁️ Alle ${hiddenItems.length} Projekt-Elemente einblenden</button>` : ''}
                      <button id="emptyCanvasInvBtn" class="btn btn-sm" type="button">📦 Aus Inventory</button>
                      <button id="emptyCanvasImgBtn" class="btn btn-sm" type="button">＋ Bild</button>
                    </div>
                  </div>
                ` : ''}
                ${visualItems.map((rawItem) => {
                  const item = resolveBoardItem(rawItem, folderId);
                  const c = rawItem.canvas;
                  const isSelected = state.selectedCanvasIds.has(rawItem.id);
                  const src = item.localDataUrl || item.previewImageUrl || '';
                  const hasVisual = !!(src || item.driveFileId);
                  const linkUrl = item.url || item.sourceUrl || '';
                  let domain = '';
                  try { if (linkUrl) domain = new URL(linkUrl).hostname.replace(/^www\./, ''); } catch (e) {}
                  const shapeCls = c.shape === 'circle' ? 'shape-circle' : (c.shape === 'rounded' ? 'shape-rounded' : '');
                  const fCol = c.frameColor || (c.frame === 'white' ? '#FFFFFF' : '');
                  const fWidth = Math.max(1, Number(c.frameWidth) || 6);
                  const frameStyle = fCol ? `border:${fWidth}px solid ${escapeHtml(fCol)};` : '';
                  const shadowStyle = (c.shadow === false || c.removeWhiteBg) ? 'box-shadow:none;' : (fCol ? 'box-shadow:var(--shadow-md);' : '');
                  const itemFit = c.fitMode || fitMode;
                  const cx = c.cropX ?? 50;
                  const cy = c.cropY ?? 50;
                  const cz = c.cropZoom || 1;
                  const imgStyle = `object-position:${cx}% ${cy}%; transform:scale(${cz}); transform-origin:${cx}% ${cy}%;`;
                  return `
                    <div class="canvas-item ${isSelected ? 'selected' : ''} ${itemFit === 'contain' ? 'fit-contain' : ''} ${shapeCls} ${c.removeWhiteBg ? 'bg-removed' : ''}"
                         data-canvas-id="${rawItem.id}"
                         data-canvas-kind="item"
                         style="left:${c.x}px; top:${c.y}px; width:${c.w}px; height:${c.h}px; z-index:${c.z || 1}; ${frameStyle} ${shadowStyle}">
                      ${hasVisual
                        ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(item.title)}" data-drive-img="${item.driveFileId || ''}" style="${imgStyle}" />`
                        : `<div style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:12px; text-align:center; gap:6px; background:var(--card-bg);">
                             <span style="font-size:1.8rem;">🔗</span>
                             <strong style="font-size:0.82rem; color:var(--text-primary); display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(item.title || 'Bookmark')}</strong>
                             ${domain ? `<span style="font-size:0.7rem; color:var(--text-muted);">${escapeHtml(domain)}</span>` : ''}
                           </div>`
                      }
                      ${linkUrl ? `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener" data-canvas-link="1" title="Link öffnen" style="position:absolute; top:6px; right:6px; width:24px; height:24px; border-radius:50%; background:rgba(26,28,27,0.72); color:#fff; display:flex; align-items:center; justify-content:center; font-size:0.78rem; text-decoration:none;">↗</a>` : ''}
                      <div class="canvas-item-label">${escapeHtml(item.title || 'Bild')}</div>
                      ${state.canvasLocked ? '' : '<div class="canvas-resize-handle" data-resize-handle="1" title="Ecke ziehen (proportional) · Umschalt+Ziehen (frei)"></div>'}
                    </div>
                  `;
                }).join('')}

                ${canvasElements.map((el) => {
                  const isSelected = state.selectedCanvasIds.has(el.id);
                  if (el.type === 'palette') {
                    const colors = Array.isArray(el.colors) ? el.colors : ['#4A5D3B', '#A8A84D', '#5D8798', '#8BB5BF', '#EAEAEA'];
                    const isVert = el.orientation === 'vertical';
                    return `
                      <div class="canvas-item ${isSelected ? 'selected' : ''}"
                           data-canvas-id="${el.id}"
                           data-canvas-kind="el"
                           style="left:${el.x}px; top:${el.y}px; width:${el.w}px; height:${el.h}px; z-index:${el.z || 10}; box-shadow:none;">
                        <div class="canvas-el-palette ${el.shape === 'circle' ? 'circle' : ''} ${isVert ? 'vertical' : ''}">
                          ${colors.map((hex) => `<div class="canvas-el-swatch" style="background:${escapeHtml(hex)};"></div>`).join('')}
                        </div>
                        ${state.canvasLocked ? '' : '<div class="canvas-resize-handle" data-resize-handle="1"></div>'}
                      </div>
                    `;
                  }
                  const shapeCls = el.shape === 'circle' ? 'shape-circle' : (el.shape === 'pill' ? 'shape-rounded' : '');
                  const fCol = el.frame ? (el.frameColor || '#FFFFFF') : '';
                  const frameStyle = fCol ? `border:6px solid ${escapeHtml(fCol)}; box-shadow:var(--shadow-md);` : '';
                  const bgStyle = el.shape === 'none' ? 'transparent' : (el.bgColor || '#262927');
                  const fontFam = el.fontStyle === 'serif' ? 'Georgia, serif' : 'inherit';
                  const align = el.textAlign || 'center';
                  const justify = align === 'left' ? 'flex-start' : (align === 'right' ? 'flex-end' : 'center');
                  const outlineCss = el.fontStyle === 'outline'
                    ? `color:transparent; -webkit-text-stroke: 1.5px ${escapeHtml(el.color || '#A59858')};`
                    : `color:${escapeHtml(el.color || '#262927')};`;
                  const padStyle = el.shape === 'circle' ? 'padding:14%;' : '';
                  return `
                    <div class="canvas-item ${isSelected ? 'selected' : ''} ${shapeCls}"
                         data-canvas-id="${el.id}"
                         data-canvas-kind="el"
                         style="left:${el.x}px; top:${el.y}px; width:${el.w}px; height:${el.h}px; z-index:${el.z || 10}; background-color:${escapeHtml(bgStyle)}; ${frameStyle} ${el.shape === 'none' ? 'box-shadow:none;' : ''}">
                      <div class="canvas-el-text" style="${padStyle} font-size:${Number(el.fontSize) || 24}px; font-family:${fontFam}; justify-content:center; font-weight:${el.fontStyle === 'outline' ? '800' : '500'}; ${outlineCss}"><span style="display:inline-block; width:100%; text-align:${align};">${escapeHtml(el.text || 'Text').replace(/\n/g, '<br>')}</span></div>
                      ${state.canvasLocked ? '' : '<div class="canvas-resize-handle" data-resize-handle="1"></div>'}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
            ${state.canvasSplitOpen ? '<aside id="canvasSplitPanel" class="split-panel"></aside>' : ''}
          </div>
          </div>
        `;

        const viewport = document.getElementById('canvasViewport');
        const stage = document.getElementById('canvasStage');
        const paletteBar = document.getElementById('canvasPaletteBar');
        if (savedVpScroll) {
          viewport.scrollLeft = savedVpScroll.left;
          viewport.scrollTop = savedVpScroll.top;
          requestAnimationFrame(() => {
            viewport.scrollLeft = savedVpScroll.left;
            viewport.scrollTop = savedVpScroll.top;
            window.scrollTo(window.scrollX, savedWinY);
          });
        }

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

        const cutoutCache = state.cutoutCache || (state.cutoutCache = new Map());

        function createCutoutDataUrl(imgEl, tolerance = 8) {
          const origSrc = imgEl.dataset.origSrc || imgEl.src;
          if (!origSrc || (origSrc.startsWith('data:image/png;base64,') && !imgEl.dataset.origSrc)) return origSrc;
          const key = `${origSrc}::${tolerance}`;
          if (cutoutCache.has(key)) return cutoutCache.get(key);
          try {
            const maxSide = 1100;
            const scale = Math.min(1, maxSide / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
            const w = Math.max(1, Math.round(imgEl.naturalWidth * scale));
            const h = Math.max(1, Math.round(imgEl.naturalHeight * scale));
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(imgEl, 0, 0, w, h);
            const imgData = ctx.getImageData(0, 0, w, h);
            const data = imgData.data;
            const visited = new Uint8Array(w * h);
            const queue = new Int32Array(w * h);
            let head = 0, tail = 0;

            const thr = 255 - tolerance;
            const softStep = Math.min(10, Math.max(3, Math.round(tolerance * 0.4)));
            const softThr = thr - softStep;
            const isNearWhite = (idx) => {
              const p = idx * 4;
              return data[p] >= thr && data[p + 1] >= thr && data[p + 2] >= thr;
            };

            for (let x = 0; x < w; x++) {
              const top = x;
              const bot = (h - 1) * w + x;
              if (isNearWhite(top) && !visited[top]) { visited[top] = 1; queue[tail++] = top; }
              if (isNearWhite(bot) && !visited[bot]) { visited[bot] = 1; queue[tail++] = bot; }
            }
            for (let y = 0; y < h; y++) {
              const left = y * w;
              const right = y * w + (w - 1);
              if (isNearWhite(left) && !visited[left]) { visited[left] = 1; queue[tail++] = left; }
              if (isNearWhite(right) && !visited[right]) { visited[right] = 1; queue[tail++] = right; }
            }

            while (head < tail) {
              const idx = queue[head++];
              const p = idx * 4;
              data[p + 3] = 0;
              const x = idx % w;
              const y = (idx - x) / w;
              if (x > 0) { const n = idx - 1; if (!visited[n] && isNearWhite(n)) { visited[n] = 1; queue[tail++] = n; } }
              if (x < w - 1) { const n = idx + 1; if (!visited[n] && isNearWhite(n)) { visited[n] = 1; queue[tail++] = n; } }
              if (y > 0) { const n = idx - w; if (!visited[n] && isNearWhite(n)) { visited[n] = 1; queue[tail++] = n; } }
              if (y < h - 1) { const n = idx + w; if (!visited[n] && isNearWhite(n)) { visited[n] = 1; queue[tail++] = n; } }
            }

            // Weiche Kante an direkten Nachbarn transparenter Pixel
            for (let idx = 0; idx < w * h; idx++) {
              if (visited[idx]) continue;
              const p = idx * 4;
              const minCh = Math.min(data[p], data[p + 1], data[p + 2]);
              if (minCh < softThr) continue;
              const x = idx % w;
              const y = (idx - x) / w;
              const touchesBg =
                (x > 0 && visited[idx - 1]) ||
                (x < w - 1 && visited[idx + 1]) ||
                (y > 0 && visited[idx - w]) ||
                (y < h - 1 && visited[idx + w]);
              if (touchesBg) {
                const factor = Math.max(0, Math.min(1, (thr - minCh) / (thr - softThr)));
                data[p + 3] = Math.round(data[p + 3] * factor);
              }
            }

            ctx.putImageData(imgData, 0, 0);
            const outUrl = c.toDataURL('image/png');
            cutoutCache.set(key, outUrl);
            return outUrl;
          } catch (e) {
            return origSrc;
          }
        }

        function maybeSnapAutoAspect(imgEl) {
          const itemEl = imgEl.closest('.canvas-item');
          if (!itemEl || !imgEl.naturalWidth || !imgEl.naturalHeight) return;
          const id = itemEl.getAttribute('data-canvas-id');
          const raw = visualItems.find((i) => i.id === id);
          if (raw && raw.canvas && raw.canvas._needsAutoAspect) {
            delete raw.canvas._needsAutoAspect;
            if (raw.canvas.shape !== 'circle') {
              const ratio = imgEl.naturalHeight / imgEl.naturalWidth;
              raw.canvas.h = Math.max(80, Math.min(480, Math.round(raw.canvas.w * ratio)));
              itemEl.style.height = raw.canvas.h + 'px';
              scheduleBoardSave(folderId);
            }
          }
          if (raw && raw.canvas && raw.canvas.removeWhiteBg && !imgEl.dataset.cutoutApplied) {
            imgEl.dataset.origSrc = imgEl.src;
            imgEl.dataset.cutoutApplied = '1';
            imgEl.src = createCutoutDataUrl(imgEl, raw.canvas.bgTolerance ?? 8);
          }
          updatePaletteBar();
        }

        // Drive-Bilder CORS-frei nachladen und danach Palette aktualisieren
        let pendingImgs = 0;
        stage.querySelectorAll('img[data-drive-img]').forEach(async (imgEl) => {
          const fileId = imgEl.getAttribute('data-drive-img');
          if (!fileId || state.mode !== 'drive') {
            if (imgEl.complete && imgEl.naturalWidth) maybeSnapAutoAspect(imgEl);
            else imgEl.addEventListener('load', () => maybeSnapAutoAspect(imgEl), { once: true });
            return;
          }
          pendingImgs++;
          try {
            imgEl.src = await DriveAdapter.fetchBlobUrl(fileId);
            imgEl.addEventListener('load', () => maybeSnapAutoAspect(imgEl), { once: true });
          } catch (e) {
            console.warn(e);
          } finally {
            pendingImgs--;
            if (pendingImgs === 0) setTimeout(updatePaletteBar, 80);
          }
        });
        setTimeout(updatePaletteBar, 120);

        // Toolbar-Buttons
        document.getElementById('canvasFullscreenBtn').addEventListener('click', () => {
          state.canvasFullscreen = !state.canvasFullscreen;
          renderCanvasView(container, statsEl, folderId);
        });
        document.getElementById('canvasZoomInBtn').addEventListener('click', () => {
          state.canvasZoom = Math.min(2.5, +(state.canvasZoom + 0.15).toFixed(2));
          stage.style.transform = `scale(${state.canvasZoom})`;
          stage.style.width = `${Math.round(maxRight * state.canvasZoom)}px`;
          stage.style.height = `${Math.round(maxBottom * state.canvasZoom)}px`;
          document.getElementById('canvasResetViewBtn').textContent = `${Math.round(state.canvasZoom * 100)} %`;
        });
        const invCanvasBtn = document.getElementById('canvasAddFromInvBtn');
        if (invCanvasBtn) invCanvasBtn.addEventListener('click', () => openInventoryPickerModal(folderId));
        document.getElementById('canvasZoomOutBtn').addEventListener('click', () => {
          state.canvasZoom = Math.max(0.35, +(state.canvasZoom - 0.15).toFixed(2));
          stage.style.transform = `scale(${state.canvasZoom})`;
          stage.style.width = `${Math.round(maxRight * state.canvasZoom)}px`;
          stage.style.height = `${Math.round(maxBottom * state.canvasZoom)}px`;
          document.getElementById('canvasResetViewBtn').textContent = `${Math.round(state.canvasZoom * 100)} %`;
        });
        document.getElementById('canvasResetViewBtn').addEventListener('click', () => {
          state.canvasZoom = 1;
          stage.style.transform = 'scale(1)';
          stage.style.width = `${maxRight}px`;
          stage.style.height = `${maxBottom}px`;
          viewport.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
          document.getElementById('canvasResetViewBtn').textContent = '100 %';
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

        const fitBtn = document.getElementById('canvasFitBtn');
        if (fitBtn) fitBtn.addEventListener('click', () => {
          const selItems = visualItems.filter((it) => state.selectedCanvasIds.has(it.id));
          if (selItems.length > 0) {
            const allContain = selItems.every((it) => (it.canvas.fitMode || fitMode) === 'contain');
            const next = allContain ? 'cover' : 'contain';
            selItems.forEach((it) => { it.canvas.fitMode = next; });
            scheduleBoardSave(folderId);
          } else {
            const next = fitMode === 'contain' ? 'cover' : 'contain';
            state.canvasFitMode = next;
            visualItems.forEach((it) => { if (it.canvas) delete it.canvas.fitMode; });
            saveCanvasSetting({ fitMode: next });
          }
          renderCanvasView(container, statsEl, folderId);
        });

        const ratioSel = document.getElementById('canvasRatioSelect');
        if (ratioSel) ratioSel.addEventListener('change', (e) => {
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

        function getAllBoxEntries() {
          return [
            ...visualItems.map((it) => ({ kind: 'item', obj: it, box: it.canvas })),
            ...canvasElements.map((el) => ({ kind: 'el', obj: el, box: el }))
          ];
        }

        document.getElementById('canvasUndoBtn').addEventListener('click', () => {
          if (undoCanvasAction(folderId)) renderCanvasView(container, statsEl, folderId);
        });

        function restoreAllHiddenToCanvas() {
          if (hiddenItems.length === 0) return;
          pushCanvasUndo(folderId);
          allItems.forEach((it) => { it.canvasHidden = false; });
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        }
        const showAllHiddenBtn = document.getElementById('canvasShowAllHiddenBtn');
        if (showAllHiddenBtn) showAllHiddenBtn.addEventListener('click', restoreAllHiddenToCanvas);
        const emptyRestoreBtn = document.getElementById('emptyCanvasRestoreAllBtn');
        if (emptyRestoreBtn) emptyRestoreBtn.addEventListener('click', restoreAllHiddenToCanvas);
        const emptyInvBtn = document.getElementById('emptyCanvasInvBtn');
        if (emptyInvBtn) emptyInvBtn.addEventListener('click', () => openInventoryPickerModal(folderId));
        const emptyImgBtn = document.getElementById('emptyCanvasImgBtn');
        if (emptyImgBtn) emptyImgBtn.addEventListener('click', () => document.getElementById('fileUploadInput').click());

        if (!window._canvasUndoKeyBound) {
          window._canvasUndoKeyBound = true;
          document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && state.activeView === 'canvas' && !state.quickView) {
              const tag = document.activeElement ? document.activeElement.tagName : '';
              if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
              if (state.activeFolderId && undoCanvasAction(state.activeFolderId)) {
                e.preventDefault();
                renderMainView();
              }
            }
          });
        }

        document.getElementById('canvasSelectAllBtn').addEventListener('click', () => {
          state.selectedCanvasIds = new Set(getAllBoxEntries().map((e) => e.obj.id));
          renderCanvasView(container, statsEl, folderId);
        });
        const deselectAllBtn = document.getElementById('canvasDeselectAllBtn');
        if (deselectAllBtn) deselectAllBtn.addEventListener('click', () => {
          state.selectedCanvasIds.clear();
          renderCanvasView(container, statsEl, folderId);
        });

        if (!window._canvasSelectAllKeyBound) {
          window._canvasSelectAllKeyBound = true;
          document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && state.activeView === 'canvas' && !state.quickView) {
              const tag = document.activeElement ? document.activeElement.tagName : '';
              if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
              const fc = state.folderContents[state.activeFolderId];
              if (!fc) return;
              e.preventDefault();
              const ids = [
                ...(fc.board.items || []).filter((it) => !it.canvasHidden).map((it) => it.id),
                ...(fc.board.canvasElements || []).map((el) => el.id)
              ];
              state.selectedCanvasIds = new Set(ids);
              renderMainView();
            }
          });
        }

        const selRemoveBgBtn = document.getElementById('selRemoveBgBtn');
        if (selRemoveBgBtn) selRemoveBgBtn.addEventListener('click', () => {
          const selItems = visualItems.filter((it) => state.selectedCanvasIds.has(it.id));
          const allRemoved = selItems.every((it) => !!it.canvas.removeWhiteBg);
          selItems.forEach((it) => { it.canvas.removeWhiteBg = !allRemoved; });
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        });

        const selBgTol = document.getElementById('selBgTolerance');
        if (selBgTol) {
          selBgTol.addEventListener('input', () => {
            const tol = Math.max(1, Math.min(60, Number(selBgTol.value) || 8));
            selBgTol.title = `Weiß-Toleranz: ${tol}`;
            visualItems.forEach((it) => {
              if (!state.selectedCanvasIds.has(it.id) || !it.canvas.removeWhiteBg) return;
              it.canvas.bgTolerance = tol;
              const imgEl = stage.querySelector(`.canvas-item[data-canvas-id="${it.id}"] img`);
              if (imgEl && imgEl.dataset.origSrc) {
                const tmp = new Image();
                tmp.onload = () => {
                  tmp.dataset.origSrc = imgEl.dataset.origSrc;
                  imgEl.src = createCutoutDataUrl(tmp, tol);
                };
                tmp.src = imgEl.dataset.origSrc;
              }
            });
          });
          selBgTol.addEventListener('change', () => scheduleBoardSave(folderId));
        }

        document.querySelectorAll('#canvasSelectionBar [data-sel-shape]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const shape = btn.getAttribute('data-sel-shape');
            for (const it of visualItems) {
              if (!state.selectedCanvasIds.has(it.id)) continue;
              it.canvas.shape = shape;
              if (shape === 'circle') {
                const size = Math.min(it.canvas.w || 200, it.canvas.h || 200);
                it.canvas.w = size;
                it.canvas.h = size;
              }
            }
            scheduleBoardSave(folderId);
            renderCanvasView(container, statsEl, folderId);
          });
        });

        const selFrameBtn = document.getElementById('selFrameToggleBtn');
        if (selFrameBtn) selFrameBtn.addEventListener('click', () => {
          const selItems = visualItems.filter((it) => state.selectedCanvasIds.has(it.id));
          const allFramed = selItems.every((it) => !!(it.canvas.frameColor || it.canvas.frame === 'white'));
          selItems.forEach((it) => {
            it.canvas.frameColor = allFramed ? '' : '#FFFFFF';
            delete it.canvas.frame;
          });
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        });

        bindHexColorPair(
          document.getElementById('selFrameColorInput'),
          document.getElementById('selFrameColorHex'),
          (col) => {
            visualItems.forEach((it) => {
              if (!state.selectedCanvasIds.has(it.id)) return;
              it.canvas.frameColor = col;
              delete it.canvas.frame;
              const fw = Math.max(1, Number(it.canvas.frameWidth) || 6);
              const el = stage.querySelector(`.canvas-item[data-canvas-id="${it.id}"]`);
              if (el) el.style.border = `${fw}px solid ${col}`;
            });
            scheduleBoardSave(folderId);
          }
        );

        const selFrameWidthInp = document.getElementById('selFrameWidthInput');
        if (selFrameWidthInp) {
          selFrameWidthInp.addEventListener('input', () => {
            const fw = Math.max(1, Math.min(24, Number(selFrameWidthInp.value) || 6));
            visualItems.forEach((it) => {
              if (!state.selectedCanvasIds.has(it.id)) return;
              it.canvas.frameWidth = fw;
              if (!it.canvas.frameColor && it.canvas.frame !== 'white') it.canvas.frameColor = '#FFFFFF';
              const fCol = it.canvas.frameColor || '#FFFFFF';
              const el = stage.querySelector(`.canvas-item[data-canvas-id="${it.id}"]`);
              if (el) el.style.border = `${fw}px solid ${fCol}`;
            });
          });
          selFrameWidthInp.addEventListener('change', () => scheduleBoardSave(folderId));
        }

        const selShadowBtn = document.getElementById('selShadowToggleBtn');
        if (selShadowBtn) selShadowBtn.addEventListener('click', () => {
          const selItems = visualItems.filter((it) => state.selectedCanvasIds.has(it.id));
          const allOn = selItems.every((it) => it.canvas.shadow !== false);
          selItems.forEach((it) => { it.canvas.shadow = !allOn; });
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        });

        const selResetBtn = document.getElementById('selResetBtn');
        if (selResetBtn) selResetBtn.addEventListener('click', () => {
          for (const it of visualItems) {
            if (!state.selectedCanvasIds.has(it.id)) continue;
            it.canvas.shape = 'rect';
            it.canvas.frameColor = '';
            delete it.canvas.frame;
            delete it.canvas.frameWidth;
            delete it.canvas.shadow;
            delete it.canvas.fitMode;
            delete it.canvas.cropX;
            delete it.canvas.cropY;
            delete it.canvas.cropZoom;
            delete it.canvas.removeWhiteBg;
            const imgEl = stage.querySelector(`.canvas-item[data-canvas-id="${it.id}"] img`);
            if (imgEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
              it.canvas.h = Math.max(60, Math.round(it.canvas.w * (imgEl.naturalHeight / imgEl.naturalWidth)));
            }
          }
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        });

        function applyCropToSelected() {
          const cx = Number(document.getElementById('selCropX')?.value ?? 50);
          const cy = Number(document.getElementById('selCropY')?.value ?? 50);
          const cz = Number(document.getElementById('selCropZoom')?.value ?? 1);
          visualItems.forEach((it) => {
            if (!state.selectedCanvasIds.has(it.id)) return;
            it.canvas.cropX = cx;
            it.canvas.cropY = cy;
            it.canvas.cropZoom = cz;
            const img = stage.querySelector(`.canvas-item[data-canvas-id="${it.id}"] img`);
            if (img) {
              img.style.objectPosition = `${cx}% ${cy}%`;
              img.style.transform = `scale(${cz})`;
              img.style.transformOrigin = `${cx}% ${cy}%`;
            }
          });
        }
        ['selCropX', 'selCropY', 'selCropZoom'].forEach((cid) => {
          const inp = document.getElementById(cid);
          if (!inp) return;
          inp.addEventListener('input', applyCropToSelected);
          inp.addEventListener('change', () => scheduleBoardSave(folderId));
        });

        const selOrigBtn = document.getElementById('selOrigRatioBtn');
        if (selOrigBtn) selOrigBtn.addEventListener('click', () => {
          for (const it of visualItems) {
            if (!state.selectedCanvasIds.has(it.id)) continue;
            const imgEl = stage.querySelector(`.canvas-item[data-canvas-id="${it.id}"] img`);
            if (imgEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
              it.canvas.shape = 'rect';
              it.canvas.h = Math.max(60, Math.round(it.canvas.w * (imgEl.naturalHeight / imgEl.naturalWidth)));
            }
          }
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        });

        const selEditElBtn = document.getElementById('selEditElBtn');
        if (selEditElBtn) selEditElBtn.addEventListener('click', () => {
          const el = canvasElements.find((e) => state.selectedCanvasIds.has(e.id));
          if (el) openCanvasElementEditor(el, folderId, container, statsEl);
        });

        const selRemoveBtn = document.getElementById('selRemoveCanvasBtn');
        if (selRemoveBtn) selRemoveBtn.addEventListener('click', () => {
          pushCanvasUndo(folderId);
          visualItems.forEach((it) => { if (state.selectedCanvasIds.has(it.id)) it.canvasHidden = true; });
          content.board.canvasElements = canvasElements.filter((el) => !state.selectedCanvasIds.has(el.id));
          state.selectedCanvasIds.clear();
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        });

        function stepLayerOrder(dir) {
          if (state.selectedCanvasIds.size === 0) return;
          pushCanvasUndo(folderId);
          const sorted = getAllBoxEntries().sort((a, b) => (a.box.z || 1) - (b.box.z || 1));
          sorted.forEach((e, idx) => { e.box.z = idx + 1; });
          if (dir > 0) {
            for (let i = sorted.length - 2; i >= 0; i--) {
              if (state.selectedCanvasIds.has(sorted[i].obj.id) && !state.selectedCanvasIds.has(sorted[i + 1].obj.id)) {
                const tmp = sorted[i].box.z;
                sorted[i].box.z = sorted[i + 1].box.z;
                sorted[i + 1].box.z = tmp;
                [sorted[i], sorted[i + 1]] = [sorted[i + 1], sorted[i]];
              }
            }
          } else {
            for (let i = 1; i < sorted.length; i++) {
              if (state.selectedCanvasIds.has(sorted[i].obj.id) && !state.selectedCanvasIds.has(sorted[i - 1].obj.id)) {
                const tmp = sorted[i].box.z;
                sorted[i].box.z = sorted[i - 1].box.z;
                sorted[i - 1].box.z = tmp;
                [sorted[i], sorted[i - 1]] = [sorted[i - 1], sorted[i]];
              }
            }
          }
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        }

        const layerUpBtn = document.getElementById('canvasLayerUpBtn');
        if (layerUpBtn) layerUpBtn.addEventListener('click', () => stepLayerOrder(1));

        const layerDownBtn = document.getElementById('canvasLayerDownBtn');
        if (layerDownBtn) layerDownBtn.addEventListener('click', () => stepLayerOrder(-1));

        document.querySelectorAll('[data-bg-preset]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const col = btn.getAttribute('data-bg-preset');
            saveCanvasSetting({ bgColor: col, bgMode: col ? 'custom' : 'default' });
            renderCanvasView(container, statsEl, folderId);
          });
        });

        bindHexColorPair(
          document.getElementById('canvasBgColorInput'),
          document.getElementById('canvasBgColorHex'),
          (col) => {
            saveCanvasSetting({ bgColor: col, bgMode: 'custom' });
            viewport.style.backgroundColor = col;
          }
        );

        document.getElementById('canvasCollageBtn').addEventListener('click', () => {
          saveCanvasSetting({ collageMode: !collageMode });
          renderCanvasView(container, statsEl, folderId);
        });

        document.getElementById('canvasAiLayoutBtn').addEventListener('click', () => {
          if (visualItems.length === 0) {
            uiAlert('Bitte füge zuerst mindestens ein Bild oder Element zum Moodboard hinzu.');
            return;
          }
          document.getElementById('aiLayoutRunBtn').onclick = async () => {
            const keepFormatting = document.getElementById('aiLayoutKeepFormatCb').checked;
            const keepElements = document.getElementById('aiLayoutKeepElementsCb').checked;
            closeModal('aiLayoutModal');
            await generateAiMoodboardLayout(folderId, visualItems, content, stage, container, statsEl, { keepFormatting, keepElements });
          };
          openModal('aiLayoutModal');
        });

        document.getElementById('canvasAddTextBtn').addEventListener('click', () => {
          const all = getAllBoxEntries();
          const maxZ = Math.max(1, ...all.map((e) => (e.box && e.box.z) || 1));
          const newEl = {
            id: uid('cel'),
            type: 'text',
            x: Math.round((viewport.scrollLeft + 120) / state.canvasZoom),
            y: Math.round((viewport.scrollTop + 120) / state.canvasZoom),
            w: 220,
            h: 80,
            z: maxZ + 1,
            text: 'Moodboard',
            fontSize: 32,
            fontStyle: 'serif',
            color: '#262927',
            bgColor: '#262927',
            shape: 'none',
            frame: false
          };
          content.board.canvasElements.push(newEl);
          state.selectedCanvasIds = new Set([newEl.id]);
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
          openCanvasElementEditor(newEl, folderId, container, statsEl);
        });

        document.getElementById('canvasAddPaletteBtn').addEventListener('click', () => {
          const imgs = Array.from(stage.querySelectorAll('.canvas-item img'));
          const extracted = extractColorsFromImages(imgs, 5);
          const colors = extracted.length >= 3 ? extracted : ['#4A5D3B', '#A8A84D', '#5D8798', '#8BB5BF', '#EAEAEA'];
          const all = getAllBoxEntries();
          const maxZ = Math.max(1, ...all.map((e) => (e.box && e.box.z) || 1));
          const newEl = {
            id: uid('cel'),
            type: 'palette',
            x: Math.round((viewport.scrollLeft + 100) / state.canvasZoom),
            y: Math.round((viewport.scrollTop + 160) / state.canvasZoom),
            w: 420,
            h: 72,
            z: maxZ + 1,
            colors,
            shape: 'rect'
          };
          content.board.canvasElements.push(newEl);
          state.selectedCanvasIds = new Set([newEl.id]);
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        });

        document.getElementById('canvasExportPngBtn').addEventListener('click', () => {
          exportCanvasToPng(folderId, visualItems, canvasElements, bgColor, bgMode, fitMode, stage);
        });

        document.getElementById('canvasGridBtn').addEventListener('click', () => {
          const next = !showGrid;
          state.canvasShowGrid = next;
          saveCanvasSetting({ showGrid: next });
          renderCanvasView(container, statsEl, folderId);
        });
        document.getElementById('canvasSnapBtn').addEventListener('click', () => {
          saveCanvasSetting({ snapToGrid: !snapToGrid });
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
        document.getElementById('canvasAddImageBtn').addEventListener('click', () => {
          document.getElementById('fileUploadInput').click();
        });
        document.getElementById('canvasAddBookmarkBtn').addEventListener('click', () => openItemModal(null));

        const optBtn = document.getElementById('canvasOptionsBtn');
        const optPop = document.getElementById('canvasOptionsPopover');
        const addMenuBtn = document.getElementById('canvasAddMenuBtn');
        const addMenuPop = document.getElementById('canvasAddMenuPopover');
        optBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          addMenuPop.classList.add('hidden');
          optPop.classList.toggle('hidden');
        });
        optPop.addEventListener('click', (e) => e.stopPropagation());
        addMenuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          optPop.classList.add('hidden');
          addMenuPop.classList.toggle('hidden');
        });
        addMenuPop.addEventListener('click', (e) => e.stopPropagation());
        document.addEventListener('click', () => {
          optPop.classList.add('hidden');
          addMenuPop.classList.add('hidden');
        }, { once: true });

        if (state.canvasSplitOpen) {
          const splitEl = document.getElementById('canvasSplitPanel');
          if (splitEl) renderSplitPlanningPanel(splitEl, folderId);
        }

        // Pointer-Interaktion (Drag, Resize, Pan)
        let activeAction = null;

        stage.addEventListener('dblclick', (e) => {
          const itemEl = e.target.closest('.canvas-item[data-canvas-kind="el"]');
          if (!itemEl) return;
          const id = itemEl.getAttribute('data-canvas-id');
          const el = canvasElements.find((x) => x.id === id);
          if (el) openCanvasElementEditor(el, folderId, container, statsEl);
        });

        viewport.addEventListener('pointerdown', (e) => {
          if (e.target.closest('[data-canvas-link], button, a, input, select')) return;
          const itemEl = e.target.closest('.canvas-item');
          if (!itemEl) {
            const hadSelection = !e.shiftKey && state.selectedCanvasIds.size > 0;
            if (!e.shiftKey) {
              state.selectedCanvasIds.clear();
              stage.querySelectorAll('.canvas-item').forEach((el) => el.classList.remove('selected'));
              updatePaletteBar();
            }
            activeAction = {
              type: 'pan',
              selectionCleared: hadSelection,
              startX: e.clientX,
              startY: e.clientY,
              origScrollX: viewport.scrollLeft,
              origScrollY: viewport.scrollTop
            };
            try { if (viewport.isConnected) viewport.setPointerCapture(e.pointerId); } catch (err) {}
            return;
          }

          const id = itemEl.getAttribute('data-canvas-id');
          const kind = itemEl.getAttribute('data-canvas-kind');
          const entry = kind === 'el'
            ? canvasElements.find((x) => x.id === id)
            : visualItems.find((i) => i.id === id);
          if (!entry) return;
          const box = kind === 'el' ? entry : entry.canvas;

          const selectionChanged = !state.selectedCanvasIds.has(id);
          if (!e.shiftKey && selectionChanged) {
            state.selectedCanvasIds.clear();
            stage.querySelectorAll('.canvas-item').forEach((el) => el.classList.remove('selected'));
          }
          state.selectedCanvasIds.add(id);
          itemEl.classList.add('selected');
          updatePaletteBar();

          if (state.canvasLocked) {
            if (selectionChanged) renderCanvasView(container, statsEl, folderId);
            return;
          }

          const isResize = e.target.hasAttribute('data-resize-handle');
          const aspectRatio = box.shape === 'circle'
            ? 1
            : (kind === 'item' ? ((box.h || 200) / Math.max(1, box.w || 200)) : 0);

          activeAction = {
            type: isResize ? 'resize' : 'drag',
            box,
            itemEl,
            aspectRatio,
            selectionChanged,
            undoPushed: true,
            startX: e.clientX,
            startY: e.clientY,
            origX: box.x,
            origY: box.y,
            origW: box.w,
            origH: box.h
          };
          pushCanvasUndo(folderId);
          try { if (viewport.isConnected) viewport.setPointerCapture(e.pointerId); } catch (err) {}
        });

        viewport.addEventListener('pointermove', (e) => {
          if (!activeAction) return;
          const dx = (e.clientX - activeAction.startX) / state.canvasZoom;
          const dy = (e.clientY - activeAction.startY) / state.canvasZoom;

          if (activeAction.type === 'pan') {
            viewport.scrollLeft = activeAction.origScrollX - (e.clientX - activeAction.startX);
            viewport.scrollTop = activeAction.origScrollY - (e.clientY - activeAction.startY);
          } else if (activeAction.type === 'drag') {
            activeAction.moved = true;
            const rawX = activeAction.origX + dx;
            const rawY = activeAction.origY + dy;
            activeAction.box.x = snapToGrid ? Math.round(rawX / 12) * 12 : Math.round(rawX);
            activeAction.box.y = snapToGrid ? Math.round(rawY / 12) * 12 : Math.round(rawY);
            activeAction.itemEl.style.left = activeAction.box.x + 'px';
            activeAction.itemEl.style.top = activeAction.box.y + 'px';
          } else if (activeAction.type === 'resize') {
            activeAction.moved = true;
            const rawW = Math.max(60, activeAction.origW + dx);
            let newW = snapToGrid ? Math.max(60, Math.round(rawW / 12) * 12) : Math.round(rawW);
            let newH = snapToGrid ? Math.max(36, Math.round((activeAction.origH + dy) / 12) * 12) : Math.max(36, Math.round(activeAction.origH + dy));
            if (activeAction.aspectRatio > 0 && !e.shiftKey) {
              newH = Math.max(60, Math.round(newW * activeAction.aspectRatio));
            }
            activeAction.box.w = newW;
            activeAction.box.h = newH;
            activeAction.itemEl.style.width = newW + 'px';
            activeAction.itemEl.style.height = newH + 'px';
          }
        });

        viewport.addEventListener('pointerup', () => {
          if (activeAction) {
            if (activeAction.type === 'pan' && activeAction.selectionCleared) {
              renderCanvasView(container, statsEl, folderId);
            } else if (activeAction.type === 'drag' || activeAction.type === 'resize') {
              if (activeAction.moved) scheduleBoardSave(folderId);
              else if (activeAction.undoPushed) getCanvasUndoStack(folderId).pop();
              if (activeAction.selectionChanged) renderCanvasView(container, statsEl, folderId);
            }
          }
          activeAction = null;
        });
      }

      function openCanvasElementEditor(el, folderId, container, statsEl) {
        if (el.type === 'text') {
          document.getElementById('ctTextInput').value = el.text || '';
          document.getElementById('ctShapeSelect').value = el.shape || 'none';
          document.getElementById('ctFontSelect').value = el.fontStyle || 'sans';
          document.getElementById('ctAlignSelect').value = el.textAlign || 'center';
          document.getElementById('ctFontSizeInput').value = el.fontSize || 24;
          const colVal = (el.color || '#262927').toUpperCase();
          const bgVal = (el.bgColor || '#262927').toUpperCase();
          const fColVal = (el.frameColor || '#FFFFFF').toUpperCase();
          document.getElementById('ctColorInput').value = colVal;
          document.getElementById('ctColorHex').value = colVal;
          document.getElementById('ctBgColorInput').value = bgVal;
          document.getElementById('ctBgColorHex').value = bgVal;
          document.getElementById('ctFrameColorInput').value = fColVal;
          document.getElementById('ctFrameColorHex').value = fColVal;
          bindHexColorPair(document.getElementById('ctColorInput'), document.getElementById('ctColorHex'), () => {});
          bindHexColorPair(document.getElementById('ctBgColorInput'), document.getElementById('ctBgColorHex'), () => {});
          bindHexColorPair(document.getElementById('ctFrameColorInput'), document.getElementById('ctFrameColorHex'), () => {});
          document.getElementById('ctWhiteFrameCb').checked = !!el.frame;
          document.getElementById('ctSaveBtn').onclick = () => {
            el.text = document.getElementById('ctTextInput').value || 'Text';
            el.shape = document.getElementById('ctShapeSelect').value;
            el.fontStyle = document.getElementById('ctFontSelect').value;
            el.textAlign = document.getElementById('ctAlignSelect').value;
            el.fontSize = Math.max(12, Math.min(96, Number(document.getElementById('ctFontSizeInput').value) || 24));
            el.color = document.getElementById('ctColorInput').value;
            el.bgColor = document.getElementById('ctBgColorInput').value;
            el.frame = document.getElementById('ctWhiteFrameCb').checked;
            el.frameColor = document.getElementById('ctFrameColorInput').value;
            if (el.shape === 'circle') {
              const s = Math.max(120, Math.min(el.w, el.h) < 120 ? 160 : el.w);
              el.w = s;
              el.h = s;
            }
            scheduleBoardSave(folderId);
            closeModal('canvasTextModal');
            renderCanvasView(container, statsEl, folderId);
          };
          openModal('canvasTextModal');
        } else if (el.type === 'palette') {
          let draftColors = Array.isArray(el.colors) ? el.colors.slice() : ['#4A5D3B', '#A8A84D', '#5D8798', '#8BB5BF', '#EAEAEA'];
          document.getElementById('cpShapeSelect').value = el.shape || 'rect';
          document.getElementById('cpOrientationSelect').value = el.orientation || 'horizontal';
          function renderSwatches() {
            const list = document.getElementById('cpSwatchesList');
            list.innerHTML = draftColors.map((hex, idx) => `
              <div class="hex-color-pair" style="background:var(--card-subtle); padding:4px 6px; border-radius:var(--radius-sm); border:1px solid var(--border-color);">
                <input type="color" data-cp-idx="${idx}" value="${escapeHtml(hex)}" />
                <input type="text" class="form-control hex-input" data-cp-hex="${idx}" maxlength="7" value="${escapeHtml(hex.toUpperCase())}" />
                ${draftColors.length > 2 ? `<button type="button" class="btn-icon" data-cp-del="${idx}" style="width:20px; height:20px; font-size:0.7rem;">✕</button>` : ''}
              </div>
            `).join('');
            list.querySelectorAll('[data-cp-idx]').forEach((inp) => {
              const idx = Number(inp.getAttribute('data-cp-idx'));
              const hexInp = list.querySelector(`[data-cp-hex="${idx}"]`);
              bindHexColorPair(inp, hexInp, (val) => { draftColors[idx] = val; });
            });
            list.querySelectorAll('[data-cp-del]').forEach((btn) => {
              btn.addEventListener('click', () => {
                draftColors.splice(Number(btn.getAttribute('data-cp-del')), 1);
                renderSwatches();
              });
            });
          }
          renderSwatches();
          document.getElementById('cpAddColorBtn').onclick = () => {
            if (draftColors.length >= 8) return;
            draftColors.push('#C59B6D');
            renderSwatches();
          };
          document.getElementById('cpFromBoardBtn').onclick = () => {
            const imgs = Array.from(document.querySelectorAll('#canvasStage .canvas-item img'));
            const ex = extractColorsFromImages(imgs, 5);
            if (ex.length > 0) { draftColors = ex; renderSwatches(); }
          };
          document.getElementById('cpSaveBtn').onclick = () => {
            el.colors = draftColors;
            el.shape = document.getElementById('cpShapeSelect').value;
            const nextOri = document.getElementById('cpOrientationSelect').value;
            if ((el.orientation || 'horizontal') !== nextOri) {
              const oldW = el.w;
              el.w = el.h;
              el.h = oldW;
            }
            el.orientation = nextOri;
            scheduleBoardSave(folderId);
            closeModal('canvasPaletteModal');
            renderCanvasView(container, statsEl, folderId);
          };
          openModal('canvasPaletteModal');
        }
      }

      async function exportCanvasToPng(folderId, visualItems, canvasElements, bgColor, bgMode, fitMode, stage) {
        const entries = [
          ...visualItems.map((it) => ({ kind: 'item', obj: it, box: it.canvas })),
          ...canvasElements.map((el) => ({ kind: 'el', obj: el, box: el }))
        ].sort((a, b) => (a.box.z || 1) - (b.box.z || 1));

        if (entries.length === 0) return;
        showSyncStatus('Erstelle Moodboard-PNG…', true);
        const pad = 40;
        const minX = Math.min(...entries.map((e) => e.box.x || 0));
        const minY = Math.min(...entries.map((e) => e.box.y || 0));
        const maxX = Math.max(...entries.map((e) => (e.box.x || 0) + (e.box.w || 200)));
        const maxY = Math.max(...entries.map((e) => (e.box.y || 0) + (e.box.h || 200)));
        const scale = 2;
        const w = Math.max(400, (maxX - minX) + pad * 2);
        const h = Math.max(300, (maxY - minY) + pad * 2);

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);

        ctx.fillStyle = bgColor || (bgMode === 'dark' ? '#1C201E' : (bgMode === 'white' ? '#FFFFFF' : '#F8F7F4'));
        ctx.fillRect(0, 0, w, h);

        for (const e of entries) {
          const x = (e.box.x || 0) - minX + pad;
          const y = (e.box.y || 0) - minY + pad;
          const bw = e.box.w || 200;
          const bh = e.box.h || 200;

          if (e.kind === 'item') {
            const imgEl = stage.querySelector(`.canvas-item[data-canvas-id="${e.obj.id}"] img`);
            if (!imgEl || !imgEl.complete || !imgEl.naturalWidth) continue;
            ctx.save();
            if (e.box.shape === 'circle') {
              ctx.beginPath();
              ctx.arc(x + bw / 2, y + bh / 2, Math.min(bw, bh) / 2, 0, Math.PI * 2);
              ctx.clip();
            } else if (e.box.shape === 'rounded') {
              ctx.beginPath();
              ctx.roundRect(x, y, bw, bh, 12);
              ctx.clip();
            } else {
              ctx.beginPath();
              ctx.rect(x, y, bw, bh);
              ctx.clip();
            }
            const itemFit = e.box.fitMode || fitMode;
            const ir = imgEl.naturalWidth / imgEl.naturalHeight;
            const br = bw / bh;
            let dw = bw, dh = bh, dx = x, dy = y;
            if (itemFit === 'contain') {
              if (ir > br) { dh = bw / ir; dy = y + (bh - dh) / 2; }
              else { dw = bh * ir; dx = x + (bw - dw) / 2; }
            } else {
              const cx = (e.box.cropX ?? 50) / 100;
              const cy = (e.box.cropY ?? 50) / 100;
              const cz = e.box.cropZoom || 1;
              if (ir > br) { dw = bh * ir * cz; dh = bh * cz; }
              else { dw = bw * cz; dh = (bw / ir) * cz; }
              dx = x - (dw - bw) * cx;
              dy = y - (dh - bh) * cy;
            }
            try { ctx.drawImage(imgEl, dx, dy, dw, dh); } catch (err) {}
            ctx.restore();
            const fCol = e.box.frameColor || (e.box.frame === 'white' ? '#FFFFFF' : '');
            const fw = Math.max(1, Number(e.box.frameWidth) || 6);
            if (fCol) {
              ctx.save();
              ctx.strokeStyle = fCol;
              ctx.lineWidth = fw;
              if (e.box.shape === 'circle') {
                ctx.beginPath();
                ctx.arc(x + bw / 2, y + bh / 2, Math.min(bw, bh) / 2 - fw / 2, 0, Math.PI * 2);
                ctx.stroke();
              } else {
                ctx.strokeRect(x + fw / 2, y + fw / 2, bw - fw, bh - fw);
              }
              ctx.restore();
            }
          } else if (e.obj.type === 'palette') {
            const cols = Array.isArray(e.obj.colors) ? e.obj.colors : [];
            const gap = 8;
            const isVert = e.obj.orientation === 'vertical';
            if (isVert) {
              const sh = (bh - gap * Math.max(0, cols.length - 1)) / Math.max(1, cols.length);
              cols.forEach((hex, idx) => {
                ctx.fillStyle = hex;
                const sy = y + idx * (sh + gap);
                if (e.obj.shape === 'circle') {
                  const r = Math.min(bw, sh) / 2;
                  ctx.beginPath();
                  ctx.arc(x + bw / 2, sy + sh / 2, r, 0, Math.PI * 2);
                  ctx.fill();
                } else {
                  ctx.fillRect(x, sy, bw, sh);
                }
              });
            } else {
              const sw = (bw - gap * Math.max(0, cols.length - 1)) / Math.max(1, cols.length);
              cols.forEach((hex, idx) => {
                ctx.fillStyle = hex;
                const sx = x + idx * (sw + gap);
                if (e.obj.shape === 'circle') {
                  const r = Math.min(sw, bh) / 2;
                  ctx.beginPath();
                  ctx.arc(sx + sw / 2, y + bh / 2, r, 0, Math.PI * 2);
                  ctx.fill();
                } else {
                  ctx.fillRect(sx, y, sw, bh);
                }
              });
            }
          } else if (e.obj.type === 'text') {
            ctx.save();
            const tfCol = e.obj.frameColor || '#FFFFFF';
            if (e.obj.shape === 'circle') {
              ctx.beginPath();
              ctx.arc(x + bw / 2, y + bh / 2, Math.min(bw, bh) / 2, 0, Math.PI * 2);
              ctx.fillStyle = e.obj.bgColor || '#262927';
              ctx.fill();
              if (e.obj.frame) { ctx.strokeStyle = tfCol; ctx.lineWidth = 6; ctx.stroke(); }
            } else if (e.obj.shape === 'pill') {
              ctx.beginPath();
              ctx.roundRect(x, y, bw, bh, 12);
              ctx.fillStyle = e.obj.bgColor || '#262927';
              ctx.fill();
              if (e.obj.frame) { ctx.strokeStyle = tfCol; ctx.lineWidth = 6; ctx.stroke(); }
            }
            const fs = Number(e.obj.fontSize) || 24;
            const fam = e.obj.fontStyle === 'serif' ? 'Georgia, serif' : 'system-ui, sans-serif';
            ctx.font = `${e.obj.fontStyle === 'outline' ? '800' : '500'} ${fs}px ${fam}`;
            const align = e.obj.textAlign || 'center';
            ctx.textAlign = align;
            ctx.textBaseline = 'middle';
            const padX = e.obj.shape === 'circle' ? Math.round(bw * 0.14) : 12;
            const tx = align === 'left' ? x + padX : (align === 'right' ? x + bw - padX : x + bw / 2);
            const lines = String(e.obj.text || '').split('\n');
            const lh = fs * 1.18;
            const startY = y + bh / 2 - ((lines.length - 1) * lh) / 2;
            lines.forEach((ln, li) => {
              if (e.obj.fontStyle === 'outline') {
                ctx.strokeStyle = e.obj.color || '#A59858';
                ctx.lineWidth = 1.5;
                ctx.strokeText(ln, tx, startY + li * lh);
              } else {
                ctx.fillStyle = e.obj.color || '#262927';
                ctx.fillText(ln, tx, startY + li * lh);
              }
            });
            ctx.restore();
          }
        }

        try {
          const url = canvas.toDataURL('image/png');
          const a = document.createElement('a');
          const folder = state.folders.find((f) => f.id === folderId);
          a.href = url;
          a.download = `${(folder ? folder.name : 'Moodboard').replace(/[^a-z0-9äöüß_-]/gi, '_')}-Moodboard.png`;
          a.click();
          showSyncStatus('✅ Moodboard als PNG gespeichert', true);
          setTimeout(() => showSyncStatus('', false), 2200);
        } catch (err) {
          showSyncStatus('', false);
          await uiAlert('PNG-Export fehlgeschlagen (evtl. blockiert ein externes Bookmark-Bild den Export): ' + err.message, 'Hinweis');
        }
      }

      function buildEditorialGridPlan(visualItems, director, projectTitle, fallbackPalette, keepFormatting = false) {
        const gap = 14;
        const boardW = 840;
        const startX = 40;
        let curY = 40;

        const idMap = new Map(visualItems.map((it) => [it.id, it]));
        const orderedIds = Array.isArray(director.orderedIds)
          ? director.orderedIds.filter((id) => idMap.has(id))
          : [];
        for (const it of visualItems) {
          if (!orderedIds.includes(it.id)) orderedIds.push(it.id);
        }

        let circleSet;
        if (keepFormatting) {
          circleSet = new Set(orderedIds.filter((id) => {
            const it = idMap.get(id);
            return it && it.canvas && it.canvas.shape === 'circle';
          }));
        } else {
          circleSet = new Set(Array.isArray(director.circleIds) ? director.circleIds.filter((id) => idMap.has(id)).slice(0, 2) : []);
          if (circleSet.size === 0 && orderedIds.length >= 6) {
            circleSet.add(orderedIds[orderedIds.length - 1]);
          }
        }

        const gridIds = orderedIds.filter((id) => !circleSet.has(id));
        const itemsLayout = [];
        let zCounter = 1;

        // Hilfsfunktion: Reihe mit exakt bündiger Breite boardW & gleicher Höhe
        function layoutRow(rowIds, rowH) {
          if (rowIds.length === 0) return;
          const totalGap = gap * (rowIds.length - 1);
          const availW = boardW - totalGap;
          const aspects = rowIds.map((id) => {
            const it = idMap.get(id);
            const ar = (it.canvas && it.canvas.w && it.canvas.h) ? (it.canvas.w / it.canvas.h) : 1;
            return Math.max(0.55, Math.min(1.85, ar));
          });
          const sumAr = aspects.reduce((s, a) => s + a, 0);
          let curX = startX;
          rowIds.forEach((id, idx) => {
            const isLast = idx === rowIds.length - 1;
            const w = isLast ? (startX + boardW - curX) : Math.round((aspects[idx] / sumAr) * availW);
            itemsLayout.push({ id, x: curX, y: curY, w, h: rowH, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
            curX += w + gap;
          });
          curY += rowH + gap;
        }

        // 1) Hero-Block oben (falls >= 3 Grid-Bilder: 1 großes links + 2 gestapelt rechts, sonst 1 Reihe)
        let cursor = 0;
        if (gridIds.length >= 3) {
          const heroId = gridIds[0];
          const r1Id = gridIds[1];
          const r2Id = gridIds[2];
          const leftW = Math.round(boardW * 0.58) - Math.round(gap / 2);
          const rightW = boardW - leftW - gap;
          const heroH = 340;
          const subH = Math.round((heroH - gap) / 2);
          itemsLayout.push({ id: heroId, x: startX, y: curY, w: leftW, h: heroH, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          itemsLayout.push({ id: r1Id, x: startX + leftW + gap, y: curY, w: rightW, h: subH, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          itemsLayout.push({ id: r2Id, x: startX + leftW + gap, y: curY + subH + gap, w: rightW, h: heroH - subH - gap, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          curY += heroH + gap;
          cursor = 3;
        }

        const paletteY = curY;
        const swatchHexes = Array.isArray(director.prioritySwatches) ? director.prioritySwatches : [];
        const rawPal = [
          ...swatchHexes,
          ...(Array.isArray(director.palette) ? director.palette : []),
          ...fallbackPalette
        ].map((h) => String(h || '').toUpperCase()).filter((h) => /^#[0-9A-F]{6}$/.test(h));
        const palColors = Array.from(new Set(rawPal)).slice(0, Math.max(5, Math.min(6, swatchHexes.length || 5)));
        const elements = [
          {
            id: uid('cel'),
            type: 'palette',
            x: startX,
            y: paletteY,
            w: boardW,
            h: 54,
            z: 18,
            colors: palColors,
            shape: 'rect',
            orientation: 'horizontal'
          }
        ];
        curY += 54 + gap;

        // 2) Restliche Bilder in saubere 3er- oder 2er-Reihen aufteilen (ohne Rest-Lücke!)
        const rest = gridIds.slice(cursor);
        let rIdx = 0;
        while (rIdx < rest.length) {
          const remaining = rest.length - rIdx;
          const count = remaining === 4 ? 2 : Math.min(3, remaining);
          const rowIds = rest.slice(rIdx, rIdx + count);
          const rowH = count === 1 ? 260 : (count === 2 ? 250 : 215);
          layoutRow(rowIds, rowH);
          rIdx += count;
        }

        // 3) Kreis-Details sauber auf Schnittpunkte setzen
        const circleList = Array.from(circleSet);
        if (circleList[0]) {
          itemsLayout.push({
            id: circleList[0],
            x: startX + Math.round(boardW * 0.58) - 85,
            y: Math.max(40, paletteY - 125),
            w: 170,
            h: 170,
            z: 24,
            shape: 'circle',
            frameColor: '#FFFFFF',
            frameWidth: 6,
            shadow: true
          });
        }
        if (circleList[1] && curY > paletteY + 200) {
          itemsLayout.push({
            id: circleList[1],
            x: startX + Math.round(boardW * 0.33) - 80,
            y: paletteY + 145,
            w: 160,
            h: 160,
            z: 25,
            shape: 'circle',
            frameColor: '#FFFFFF',
            frameWidth: 6,
            shadow: true
          });
        }

        // 4) Typo-Badge (dunkler Kreis mit weißem Rand wie im Minimalist-Beispiel)
        elements.push({
          id: uid('cel'),
          type: 'text',
          x: startX + 24,
          y: paletteY - 115,
          w: 155,
          h: 155,
          z: 26,
          text: director.badgeText || projectTitle || 'Moodboard',
          fontSize: 18,
          fontStyle: 'sans',
          textAlign: 'center',
          color: '#FFFFFF',
          bgColor: director.badgeBg || '#262927',
          shape: 'circle',
          frame: true,
          frameColor: '#FFFFFF'
        });

        return {
          bgColor: director.bgColor || '#F6F4EF',
          collageMode: true,
          items: itemsLayout,
          elements
        };
      }

      async function generateAiMoodboardLayout(folderId, visualItems, content, stage, container, statsEl, opts = {}) {
        const { keepFormatting = false, keepElements = false } = opts;
        if (visualItems.length === 0) {
          await uiAlert('Bitte füge zuerst mindestens ein Bild oder Element zum Moodboard hinzu.');
          return;
        }
        const { geminiKey } = getSettings();
        const folder = state.folders.find((f) => f.id === folderId);
        let home = content.board.projectHome || {};

        // Falls wir in einem Unterordner sind: Swatches & Leitidee vom übergeordneten Hauptprojekt erben
        if (!Array.isArray(home.swatches) || home.swatches.length === 0) {
          const ancestorIds = [];
          let cur = folder;
          const seen = new Set([folderId]);
          while (cur && cur.parents && cur.parents[0] && cur.parents[0] !== state.rootFolderId && !seen.has(cur.parents[0])) {
            seen.add(cur.parents[0]);
            ancestorIds.push(cur.parents[0]);
            cur = state.folders.find((f) => f.id === cur.parents[0]);
          }
          if (ancestorIds.length > 0) {
            await ensureFoldersLoaded(ancestorIds);
            for (const aId of ancestorIds) {
              const aHome = state.folderContents[aId]?.board?.projectHome;
              if (aHome && Array.isArray(aHome.swatches) && aHome.swatches.length > 0) {
                home = {
                  ...aHome,
                  ...home,
                  swatches: aHome.swatches,
                  lead: home.lead || aHome.lead || '',
                  eyebrow: home.eyebrow || aHome.eyebrow || ''
                };
                break;
              }
            }
          }
        }

        const projectTitle = (content.board.projectHome && content.board.projectHome.title && content.board.projectHome.title !== 'Projekt')
          ? content.board.projectHome.title
          : (folder ? folder.name : 'Moodboard');
        const imgs = Array.from(stage.querySelectorAll('.canvas-item img'));
        const extracted = extractColorsFromImages(imgs, 8).filter((h) => h !== '#FFFFFF' && h !== '#000000');
        const swatchHexes = (home.swatches || []).map((s) => s.hex).filter(Boolean);
        const fallbackPalette = Array.from(new Set([...swatchHexes, ...extracted, '#C59B6D', '#4A5D3B', '#5D8798', '#EAE6DF', '#262927'])).slice(0, 5);

        let director = {};
        if (geminiKey) {
          showSyncStatus('✨ KI kuratiert Reihenfolge, Farben & Highlights…', true);
          try {
            const itemInfos = visualItems.map((it) => {
              const resolved = resolveBoardItem(it, folderId);
              const imgEl = stage.querySelector(`.canvas-item[data-canvas-id="${it.id}"] img`);
              const ar = (imgEl && imgEl.naturalWidth > 0)
                ? +(imgEl.naturalHeight / imgEl.naturalWidth).toFixed(2)
                : +((it.canvas.h || 200) / Math.max(1, it.canvas.w || 200)).toFixed(2);
              return {
                id: it.id,
                title: resolved.title || 'Element',
                tags: resolved.tags || [],
                aspectRatioHtoW: ar,
                colors: (resolved.ai && resolved.ai.colorNames) ? resolved.ai.colorNames : []
              };
            });

            const prompt = `Du bist Creative Director für Editorial-Moodboards. Kuratiere die Reihenfolge und Highlights für ein Projekt-Moodboard (das exakte Raster berechnet danach unsere Layout-Engine, du gibst KEINE Pixelkoordinaten aus).
Projekt: ${JSON.stringify({ title: projectTitle, eyebrow: home.eyebrow || '', lead: home.lead || '', swatches: home.swatches || [], extractedColors: fallbackPalette })}
Bilder: ${JSON.stringify(itemInfos)}
Regeln:
- "orderedIds": Alle Bild-IDs in harmonischer Reihenfolge. Das ERSTE Bild ist das große Hero-Bild (am besten ein stimmungsvolles Querformat/Szene-Bild). Danach 2 passende Ergänzungsbilder, dann weitere thematisch/farblich gruppiert.
- "circleIds": 1-2 IDs von Detail-/Akzentbildern (z. B. kleines Deko-Objekt), die als runde Kreis-Ausschnitte hervorgehoben werden.
- "bgColor": Eine sehr dezente, helle Hintergrundfarbe als Hex passend zum Thema (z. B. "#F6F2EA", "#F3F5F8", "#F4F6F2", "#FFFFFF").
- "palette": Genau 5 harmonische Hex-Farben passend zu Projekt & Bildern (echte Akzent- und Materialfarben, nicht nur Grau).
- "badgeText": Kurzer, stilvoller 1-3-Wort-Titel für das runde Badge (z. B. "${projectTitle}").
- "badgeBg": Dunkler oder warmer Akzent-Hex für das runde Badge (z. B. "#262927", "#2F5241", "#5D4E3E").
Antworte ausschließlich als JSON.`;
            director = await requestGeminiJson(prompt, geminiKey, 1500, 0.35);
          } catch (err) {
            console.warn('KI-Layout Fallback aktiv:', err);
          }
          showSyncStatus('', false);
        }

        const plan = buildEditorialGridPlan(visualItems, { ...(director || {}), prioritySwatches: swatchHexes }, projectTitle, fallbackPalette, keepFormatting);

        pushCanvasUndo(folderId);

        const planMap = new Map(plan.items.map((p) => [p.id, p]));
        visualItems.forEach((it) => {
          const p = planMap.get(it.id);
          if (p) {
            it.canvas.x = p.x;
            it.canvas.y = p.y;
            it.canvas.w = p.w;
            it.canvas.h = p.h;
            it.canvas.z = p.z;
            if (!keepFormatting) {
              it.canvas.shape = p.shape;
              it.canvas.frameColor = p.frameColor || '';
              it.canvas.frameWidth = p.frameWidth || 6;
              it.canvas.shadow = !!p.shadow;
              it.canvas.fitMode = 'cover';
              delete it.canvas.frame;
            } else if (it.canvas.shape === 'circle') {
              const s = Math.min(it.canvas.w, it.canvas.h);
              it.canvas.w = s;
              it.canvas.h = s;
            }
            delete it.canvas._needsAutoAspect;
          }
        });

        if (!keepElements) {
          content.board.canvasElements = plan.elements;
        }

        if (!content.board.canvasSettings) content.board.canvasSettings = {};
        if (plan.bgColor && /^#[0-9a-fA-F]{6}$/.test(plan.bgColor)) {
          content.board.canvasSettings.bgColor = plan.bgColor;
          content.board.canvasSettings.bgMode = 'custom';
        }
        content.board.canvasSettings.collageMode = true;

        state.selectedCanvasIds.clear();
        scheduleBoardSave(folderId);
        renderCanvasView(container, statsEl, folderId);
        showSyncStatus(geminiKey ? '✨ KI-Layout angewendet (↩️ für Zurück)' : '✨ Editorial-Layout angewendet (↩️ für Zurück)', true);
        setTimeout(() => showSyncStatus('', false), 3000);
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

        const imageItems = (content.board.items || []).map((it) => resolveBoardItem(it, folderId)).filter((it) => it && (it.type === 'image' || it.previewImageUrl));
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
        const images = (content.board.items || []).map((it) => resolveBoardItem(it, folderId)).filter((it) => it && it.type === 'image');
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
