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

      function getShapeBorderRadiusCss(shape, angle = 0, radius = 14) {
        if (shape === 'circle') return '50%';
        if (shape === 'rounded' || shape === 'pill') return `${Math.max(0, Number(radius) || 14)}px`;
        if (shape === 'semicircle') {
          const a = ((Number(angle) || 0) % 360 + 360) % 360;
          if (a === 90) return '0 100% 100% 0 / 0 50% 50% 0';
          if (a === 180) return '0 0 50% 50% / 0 0 100% 100%';
          if (a === 270) return '100% 0 0 100% / 50% 0 0 50%';
          return '50% 50% 0 0 / 100% 100% 0 0';
        }
        if (shape === 'quartercircle') {
          const a = ((Number(angle) || 0) % 360 + 360) % 360;
          if (a === 90) return '0 100% 0 0';
          if (a === 180) return '0 0 100% 0';
          if (a === 270) return '0 0 0 100%';
          return '100% 0 0 0';
        }
        return '';
      }

      function traceShapePathOnCtx(ctx, x, y, w, h, shape, angle = 0, radius = 14) {
        ctx.beginPath();
        if (shape === 'circle') {
          ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
          return;
        }
        if (shape === 'rounded' || shape === 'pill') {
          ctx.roundRect(x, y, w, h, Math.max(0, Number(radius) || 14));
          return;
        }
        if (shape === 'semicircle') {
          const a = ((Number(angle) || 0) % 360 + 360) % 360;
          if (a === 90) ctx.ellipse(x, y + h / 2, w, h / 2, 0, -Math.PI / 2, Math.PI / 2, false);
          else if (a === 180) ctx.ellipse(x + w / 2, y, w / 2, h, 0, 0, Math.PI, false);
          else if (a === 270) ctx.ellipse(x + w, y + h / 2, w, h / 2, 0, Math.PI / 2, Math.PI * 1.5, false);
          else ctx.ellipse(x + w / 2, y + h, w / 2, h, 0, Math.PI, 0, false);
          ctx.closePath();
          return;
        }
        if (shape === 'quartercircle') {
          const a = ((Number(angle) || 0) % 360 + 360) % 360;
          if (a === 90) {
            ctx.moveTo(x, y + h);
            ctx.ellipse(x, y + h, w, h, 0, -Math.PI / 2, 0, false);
          } else if (a === 180) {
            ctx.moveTo(x, y);
            ctx.ellipse(x, y, w, h, 0, 0, Math.PI / 2, false);
          } else if (a === 270) {
            ctx.moveTo(x + w, y);
            ctx.ellipse(x + w, y, w, h, 0, Math.PI / 2, Math.PI, false);
          } else {
            ctx.moveTo(x + w, y + h);
            ctx.ellipse(x + w, y + h, w, h, 0, Math.PI, Math.PI * 1.5, false);
          }
          ctx.closePath();
          return;
        }
        ctx.rect(x, y, w, h);
      }

      function renderTextContentHtml(el) {
        const align = el.textAlign || 'center';
        const col = el.color || '#262927';
        const fs = Number(el.fontSize) || 24;
        const fam = el.fontStyle === 'serif' ? 'Georgia, serif' : 'inherit';
        const bodyCss = el.fontStyle === 'outline'
          ? `color:transparent; -webkit-text-stroke: 1.5px ${escapeHtml(col)}; font-weight:800;`
          : `color:${escapeHtml(col)}; font-weight:500;`;
        let headHtml = '';
        if (el.heading) {
          const hs = Number(el.headingSize) || Math.round(fs * 1.15);
          const hStyle = el.headingStyle || 'serif';
          const hFam = (hStyle === 'serif') ? 'Georgia, serif' : 'inherit';
          const hText = hStyle === 'uppercase' ? el.heading.toUpperCase() : el.heading;
          const hCss = hStyle === 'outline'
            ? `color:transparent; -webkit-text-stroke: 1.5px ${escapeHtml(col)}; font-weight:800;`
            : `color:${escapeHtml(col)}; font-weight:700; ${hStyle === 'uppercase' ? 'letter-spacing:0.08em;' : ''}`;
          headHtml = `<div style="font-size:${hs}px; font-family:${hFam}; ${hCss} margin-bottom:${el.headingDivider ? 6 : 4}px;">${escapeHtml(hText)}</div>`;
          if (el.headingDivider) {
            headHtml += `<div style="height:1px; width:100%; background:${escapeHtml(col)}; opacity:0.55; margin-bottom:6px;"></div>`;
          }
        }
        const bodyHtml = el.text
          ? `<div style="font-size:${fs}px; font-family:${fam}; ${bodyCss}">${escapeHtml(el.text).replace(/\n/g, '<br>')}</div>`
          : '';
        return `<div style="width:100%; text-align:${align};">${headHtml}${bodyHtml}</div>`;
      }

      function layoutItemsToBoard(items, boardW, boardH) {
        if (!Array.isArray(items) || items.length === 0) return;
        const hasFixed = boardW > 0 && boardH > 0;
        if (!hasFixed) {
          const gap = 24;
          const cols = 4;
          let curX = 32;
          let curY = 32;
          let rowMaxH = 0;
          items.forEach((it, idx) => {
            if (!it.canvas) it.canvas = { w: 220, h: 210, z: idx + 1 };
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
          return;
        }

        const n = items.length;
        const pad = Math.max(12, Math.round(Math.min(boardW, boardH) * 0.035));
        const gap = Math.max(10, Math.round(Math.min(boardW, boardH) * 0.02));
        const availW = Math.max(120, boardW - pad * 2);
        const availH = Math.max(120, boardH - pad * 2);

        let bestCols = 1;
        let bestScore = -1;
        for (let c = 1; c <= n; c++) {
          const r = Math.ceil(n / c);
          const cw = (availW - gap * (c - 1)) / c;
          const ch = (availH - gap * (r - 1)) / r;
          if (cw <= 0 || ch <= 0) continue;
          const score = Math.min(cw, ch);
          if (score > bestScore) {
            bestScore = score;
            bestCols = c;
          }
        }

        const rows = Math.ceil(n / bestCols);
        const cellW = Math.max(36, (availW - gap * (bestCols - 1)) / bestCols);
        const cellH = Math.max(36, (availH - gap * (rows - 1)) / rows);

        items.forEach((it, idx) => {
          if (!it.canvas) it.canvas = { w: 220, h: 210, z: idx + 1 };
          const col = idx % bestCols;
          const row = Math.floor(idx / bestCols);
          const curW = Number(it.canvas.w) || 220;
          const curH = Number(it.canvas.h) || 210;
          const ratio = it.canvas.shape === 'circle' ? 1 : (curW / Math.max(1, curH));
          let w = cellW;
          let h = w / ratio;
          if (h > cellH) {
            h = cellH;
            w = h * ratio;
          }
          w = Math.max(36, Math.round(w));
          h = Math.max(36, Math.round(h));
          it.canvas.w = w;
          it.canvas.h = h;
          it.canvas.x = Math.round(pad + col * (cellW + gap) + (cellW - w) / 2);
          it.canvas.y = Math.round(pad + row * (cellH + gap) + (cellH - h) / 2);
          if (!it.canvas.z) it.canvas.z = idx + 1;
        });
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
        let newlyPlaced = 0;
        visualItems.forEach((item, idx) => {
          if (!item.canvas) {
            const col = idx % 4;
            const row = Math.floor(idx / 4);
            item.canvas = { x: 40 + col * 250, y: 40 + row * 240, w: 220, h: 210, z: idx + 1, _needsAutoAspect: true };
            changed = true;
            newlyPlaced++;
          }
        });
        const initCs = content.board.canvasSettings || {};
        if (newlyPlaced > 0 && newlyPlaced === visualItems.length && Number(initCs.boardWidth) > 0 && Number(initCs.boardHeight) > 0) {
          layoutItemsToBoard(visualItems, Number(initCs.boardWidth), Number(initCs.boardHeight));
        }
        if (changed) scheduleBoardSave(folderId);
        const undoCount = getCanvasUndoStack(folderId).length;

        const cs = content.board.canvasSettings || {};
        const fitMode = cs.fitMode || state.canvasFitMode;
        const bgMode = cs.bgMode || state.canvasBg;
        const bgColor = cs.bgColor || '';
        const collageMode = !!cs.collageMode;
        const snapToGrid = !!cs.snapToGrid;
        const showGrid = collageMode ? false : (cs.showGrid !== undefined ? cs.showGrid : state.canvasShowGrid);
        const boardW = Number(cs.boardWidth) || 0;
        const boardH = Number(cs.boardHeight) || 0;
        const hasFixedBoard = boardW > 0 && boardH > 0;
        const artBg = bgColor || (bgMode === 'dark' ? '#1C201E' : (bgMode === 'white' ? '#FFFFFF' : '#F8F7F4'));

        const allBoxes = [
          ...visualItems.map((it) => it.canvas),
          ...canvasElements
        ];
        const maxRight = Math.max(2000, boardW + 200, ...allBoxes.map((c) => (c.x || 0) + (c.w || 220) + 400));
        const maxBottom = Math.max(1400, boardH + 200, ...allBoxes.map((c) => (c.y || 0) + (c.h || 210) + 400));

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
                  <button id="canvasAddPlaceholderBtn" class="tree-menu-item" type="button">⬜ Platzhalter</button>
                  <button id="canvasAddTextBtn" class="tree-menu-item" type="button">🔤 Text / Badge</button>
                  <button id="canvasAddPaletteBtn" class="tree-menu-item" type="button">🎨 Farbpalette</button>
                  <button id="canvasAddLineBtn" class="tree-menu-item" type="button">➖ Linie</button>
                  <button id="canvasShowAllHiddenBtn" class="tree-menu-item" type="button" ${hiddenItems.length === 0 ? 'disabled style="opacity:0.45;"' : ''}>👁️ Alle Projekt-Elemente (${hiddenItems.length})</button>
                </div>
              </div>

              <button id="canvasUndoBtn" class="btn btn-sm" type="button" ${undoCount === 0 ? 'disabled' : ''} title="Letzte Änderung rückgängig machen (Strg+Z)">↩️</button>
              <button id="canvasLockBtn" class="btn btn-sm ${state.canvasLocked ? 'btn-oak' : ''}" type="button" title="Verschieben sperren/entsperren">
                ${state.canvasLocked ? '🔒' : '🔓'}
              </button>

              <div class="pill-group" style="padding:2px;">
                <button id="canvasZoomOutBtn" class="pill-btn" type="button" title="Verkleinern">－</button>
                <button id="canvasResetViewBtn" class="pill-btn" type="button" title="Zoom auf 100 % zurücksetzen und nach oben links scrollen" style="font-size:0.76rem; padding:0 6px;">${Math.round(state.canvasZoom * 100)} %</button>
                <button id="canvasZoomInBtn" class="pill-btn" type="button" title="Vergrößern">＋</button>
              </div>
            </div>

            <div class="canvas-toolbar-group">
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
                    <div style="font-size:0.74rem; font-weight:600; color:var(--text-muted); margin-bottom:4px;">Board-Größe (Artboard)</div>
                    <select id="canvasBoardPresetSelect" class="form-control" style="padding:4px 6px; font-size:0.78rem; margin-bottom:6px;">
                      <option value="" ${!hasFixedBoard ? 'selected' : ''}>Frei (unbegrenzt)</option>
                      <option value="1440x810" ${boardW === 1440 && boardH === 810 ? 'selected' : ''}>1440 × 810 (16:9)</option>
                      <option value="1400x600" ${boardW === 1400 && boardH === 600 ? 'selected' : ''}>1400 × 600 (Panorama)</option>
                      <option value="1220x600" ${boardW === 1220 && boardH === 600 ? 'selected' : ''}>1220 × 600 (Vision Board)</option>
                      <option value="920x1160" ${boardW === 920 && boardH === 1160 ? 'selected' : ''}>920 × 1160 (Hochkant)</option>
                      <option value="1080x1080" ${boardW === 1080 && boardH === 1080 ? 'selected' : ''}>1080 × 1080 (Quadrat)</option>
                    </select>
                    <div style="display:flex; gap:5px; align-items:center; margin-bottom:8px;">
                      <input id="canvasBoardWInput" class="form-control" type="number" min="300" max="4000" value="${boardW || ''}" placeholder="Breite" style="padding:4px 6px; font-size:0.78rem;" />
                      <span>×</span>
                      <input id="canvasBoardHInput" class="form-control" type="number" min="300" max="4000" value="${boardH || ''}" placeholder="Höhe" style="padding:4px 6px; font-size:0.78rem;" />
                      <button id="canvasBoardFreeBtn" class="btn btn-sm" type="button" title="Feste Größe aufheben">Frei</button>
                    </div>
                  </div>
                  <div>
                    <div style="font-size:0.74rem; font-weight:600; color:var(--text-muted); margin-bottom:4px;">Raster &amp; Ausrichtung</div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
                      <button id="canvasGridBtn" class="btn btn-sm ${showGrid ? '' : 'btn-oak'}" type="button" style="flex:1;">${showGrid ? 'Raster: An' : 'Raster: Aus'}</button>
                      <button id="canvasSnapBtn" class="btn btn-sm ${snapToGrid ? 'btn-oak' : ''}" type="button" style="flex:1;" title="Beim Verschieben und Skalieren am 12px-Raster einrasten">${snapToGrid ? '🧲 Snap: An' : '🧲 Snap: Aus'}</button>
                    </div>
                    <button id="canvasAutoLayoutBtn" class="btn btn-sm" type="button" style="width:100%; margin-bottom:8px;" title="Richtet alle Kacheln sauber im Raster an">📐 Alle Kacheln neu anordnen</button>
                  </div>
                  <div>
                    <div style="font-size:0.74rem; font-weight:600; color:var(--text-muted); margin-bottom:4px;">Erkannte Board-Farben (Klick = kopieren)</div>
                    <div id="canvasPaletteBar" class="canvas-palette-bar" style="flex-wrap:wrap;">
                      <span style="font-size:0.76rem; color:var(--text-muted);">Farben…</span>
                    </div>
                  </div>
                </div>
              </div>

              <button id="canvasAiLayoutBtn" class="btn btn-sm" type="button" title="KI-Layout-Vorschlag im Editorial-/Collage-Stil erstellen">✨ KI-Layout</button>
              <button id="canvasTemplatesBtn" class="btn btn-sm" type="button" title="Moodboard als Template speichern oder Template laden">📑 Templates</button>
              <button id="canvasCollageBtn" class="btn btn-sm ${collageMode ? 'btn-oak' : ''}" type="button" title="Blendet Titel, Links und Raster für den sauberen Collage-Look aus">✨ Collage</button>
            </div>

            <div class="canvas-toolbar-group">
              <button id="canvasExportPngBtn" class="btn btn-sm" type="button" title="Moodboard als PNG-Bild herunterladen">📸 PNG</button>
              <button id="canvasSplitBtn" class="btn btn-sm ${state.canvasSplitOpen ? 'btn-primary' : ''}" type="button">📋 Planung</button>
              <button id="canvasFullscreenBtn" class="btn btn-sm ${state.canvasFullscreen ? 'btn-primary' : ''}" type="button" title="Moodboard auf ganzes Browserfenster vergrößern">
                ${state.canvasFullscreen ? '✕' : '⛶'}
              </button>
            </div>
          </div>

          <div id="canvasSelectionBar" class="canvas-selection-bar">
            <span class="sel-group">
              <button class="btn btn-sm" id="canvasSelectAllBtn" type="button" title="Alle Elemente auf dem Board auswählen (Strg+A)">☑️ Alle</button>
              ${selectedList.length > 0 ? `<button class="btn btn-sm" id="canvasDeselectAllBtn" type="button" title="Auswahl aufheben">✕ (${selectedList.length})</button>` : ''}
            </span>
            ${selectedList.length > 0 ? `
              ${firstSel && (firstSel.kind === 'item' || firstSel.obj.type === 'placeholder') ? (() => {
                const fc = firstSel.box;
                const isPh = firstSel.obj.type === 'placeholder';
                const fCol = fc.frameColor || (fc.frame === 'white' ? '#FFFFFF' : '');
                const fWidth = Math.max(1, Number(fc.frameWidth) || 6);
                const hasShadow = fc.shadow !== false;
                const selFit = fc.fitMode || fitMode;
                return `
                  <span class="sel-group" title="Form &amp; Format">
                    ${isPh ? '<button id="selAssignPlaceholderBtn" class="btn btn-oak btn-sm" type="button">🖼️ Bild zuweisen</button>' : ''}
                    <button class="btn btn-sm ${(!fc.shape || fc.shape === 'rect') ? 'btn-oak' : ''}" data-sel-shape="rect" type="button" title="Rechteck">▭</button>
                    <button class="btn btn-sm ${fc.shape === 'rounded' ? 'btn-oak' : ''}" data-sel-shape="rounded" type="button" title="Abgerundet">▢</button>
                    ${fc.shape === 'rounded' ? `<input id="selRadiusInput" class="form-control" type="number" min="2" max="140" value="${fc.borderRadius ?? 14}" title="Eckenradius (px)" style="width:46px; padding:3px 5px; font-size:0.78rem;" />` : ''}
                    <button class="btn btn-sm ${fc.shape === 'circle' ? 'btn-oak' : ''}" data-sel-shape="circle" type="button" title="Kreis">◯</button>
                    <button class="btn btn-sm ${fc.shape === 'semicircle' ? 'btn-oak' : ''}" data-sel-shape="semicircle" type="button" title="Halbkreis">◐</button>
                    <button class="btn btn-sm ${fc.shape === 'quartercircle' ? 'btn-oak' : ''}" data-sel-shape="quartercircle" type="button" title="Viertelkreis">◔</button>
                    ${(fc.shape === 'semicircle' || fc.shape === 'quartercircle') ? `<button class="btn btn-sm" id="selRotateShapeBtn" type="button" title="Form um 90° drehen">↻</button>` : ''}
                    ${!isPh ? `
                      <select id="canvasRatioSelect" class="form-control" style="padding:3px 6px; font-size:0.78rem; width:auto;" title="Seitenverhältnis">
                        <option value="">Format…</option>
                        <option value="free" ${fc.freeResize ? 'selected' : ''}>🔓 Frei</option>
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
                    ` : ''}
                    <button id="selImgTextBtn" class="btn btn-sm ${fc.overlayText && (fc.overlayText.text || fc.overlayText.heading) ? 'btn-oak' : ''}" type="button" title="Text/Badge direkt auf dieser Kachel anzeigen">🔤 Text</button>
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
                  ${!isPh ? `
                    <span class="sel-group" title="Bildausschnitt (X / Y / Zoom)">
                      <span>🔍</span>
                      <input id="selCropX" type="range" min="0" max="100" value="${fc.cropX ?? 50}" style="width:44px;" title="Ausschnitt Links/Rechts" />
                      <input id="selCropY" type="range" min="0" max="100" value="${fc.cropY ?? 50}" style="width:44px;" title="Ausschnitt Oben/Unten" />
                      <input id="selCropZoom" type="range" min="1" max="2.5" step="0.05" value="${fc.cropZoom || 1}" style="width:48px;" title="Ausschnitt Zoom" />
                    </span>
                  ` : ''}
                `;
              })() : ''}
              ${firstSel && firstSel.kind === 'el' && firstSel.obj.type !== 'placeholder' ? `
                <span class="sel-group">
                  <button class="btn btn-sm" id="selEditElBtn" type="button">✏️ Bearbeiten</button>
                </span>
              ` : ''}
              <span class="sel-group">
                <button class="btn btn-sm" id="canvasLayerUpBtn" type="button" title="Eine Ebene nach vorne">⬆️</button>
                <button class="btn btn-sm" id="canvasLayerDownBtn" type="button" title="Eine Ebene nach hinten">⬇️</button>
                ${firstSel && firstSel.kind === 'item' ? '<button class="btn btn-sm" id="selResetBtn" type="button" title="Form, Rand, Schatten, Ausschnitt &amp; Format zurücksetzen">↺</button>' : ''}
                ${!isInventoryFolder(folderId) && selectedList.some((s) => s.kind === 'item' && s.obj.type !== 'ref') ? '<button class="btn btn-oak btn-sm" id="selMoveToInvBtn" type="button" title="Ausgewählte Bilder ins Inventory verschieben &amp; verknüpfen">📦 Ins Inventory</button>' : ''}
                <button class="btn btn-sm" id="selRemoveCanvasBtn" type="button" style="color:var(--danger);" title="Vom Moodboard entfernen">🗑</button>
              </span>
            ` : `<span style="color:var(--text-muted);">Klicke auf ein Element auf dem Board, um Form, Rand, Ausschnitt oder Ebene anzupassen…</span>`}
          </div>

          <div class="canvas-split-layout ${state.canvasSplitOpen ? 'with-split' : ''}">
            <div id="canvasViewport" class="canvas-viewport ${showGrid ? '' : 'no-grid'} ${collageMode ? 'collage-mode' : ''} ${!hasFixedBoard && !bgColor && bgMode === 'white' ? 'bg-white' : (!hasFixedBoard && !bgColor && bgMode === 'dark' ? 'bg-dark' : '')}" style="${!hasFixedBoard && bgColor ? `background-color:${escapeHtml(bgColor)};` : (hasFixedBoard ? 'background-color:var(--bg-color);' : '')}">
              <div id="canvasStage" class="canvas-stage" style="width:${Math.round(maxRight * state.canvasZoom)}px; height:${Math.round(maxBottom * state.canvasZoom)}px; transform: scale(${state.canvasZoom});">
                ${hasFixedBoard ? `<div class="canvas-artboard" style="width:${boardW}px; height:${boardH}px; background-color:${escapeHtml(artBg)};"></div>` : ''}
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
                  const shapeCls = ['circle', 'rounded', 'semicircle', 'quartercircle'].includes(c.shape) ? `shape-${c.shape}` : '';
                  const brCss = getShapeBorderRadiusCss(c.shape, c.shapeAngle || 0, c.borderRadius ?? 14);
                  const brStyle = brCss ? `border-radius:${brCss};` : '';
                  const fCol = c.frameColor || (c.frame === 'white' ? '#FFFFFF' : '');
                  const fWidth = Math.max(1, Number(c.frameWidth) || 6);
                  const frameStyle = fCol ? `border:${fWidth}px solid ${escapeHtml(fCol)};` : '';
                  const shadowStyle = (c.shadow === false || c.removeWhiteBg) ? 'box-shadow:none;' : (fCol ? 'box-shadow:var(--shadow-md);' : '');
                  const itemFit = c.fitMode || fitMode;
                  const cx = c.cropX ?? 50;
                  const cy = c.cropY ?? 50;
                  const cz = c.cropZoom || 1;
                  const imgStyle = `object-position:${cx}% ${cy}%; transform:scale(${cz}); transform-origin:${cx}% ${cy}%;`;
                  const ovHtml = (c.overlayText && (c.overlayText.text || c.overlayText.heading))
                    ? `<div class="canvas-img-overlay-text">${renderTextContentHtml(c.overlayText)}</div>`
                    : '';
                  return `
                    <div class="canvas-item ${isSelected ? 'selected' : ''} ${itemFit === 'contain' ? 'fit-contain' : ''} ${shapeCls} ${c.removeWhiteBg ? 'bg-removed' : ''}"
                         data-canvas-id="${rawItem.id}"
                         data-canvas-kind="item"
                         style="left:${c.x}px; top:${c.y}px; width:${c.w}px; height:${c.h}px; z-index:${c.z || 1}; ${brStyle} ${frameStyle} ${shadowStyle}">
                      ${hasVisual
                        ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(item.title)}" data-drive-img="${item.driveFileId || ''}" style="${imgStyle}" />`
                        : `<div style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:12px; text-align:center; gap:6px; background:var(--card-bg);">
                             <span style="font-size:1.8rem;">🔗</span>
                             <strong style="font-size:0.82rem; color:var(--text-primary); display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(item.title || 'Bookmark')}</strong>
                             ${domain ? `<span style="font-size:0.7rem; color:var(--text-muted);">${escapeHtml(domain)}</span>` : ''}
                           </div>`
                      }
                      ${ovHtml}
                      ${linkUrl ? `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener" data-canvas-link="1" title="Link öffnen" style="position:absolute; top:6px; right:6px; width:24px; height:24px; border-radius:50%; background:rgba(26,28,27,0.72); color:#fff; display:flex; align-items:center; justify-content:center; font-size:0.78rem; text-decoration:none;">↗</a>` : ''}
                      <div class="canvas-item-label">${escapeHtml(item.title || 'Bild')}</div>
                      ${state.canvasLocked ? '' : `<div class="canvas-resize-handle" data-resize-handle="1" title="${c.freeResize ? 'Ecke ziehen (frei skalierbar)' : 'Ecke ziehen (proportional) · Umschalt+Ziehen (frei)'}"></div>`}
                    </div>
                  `;
                }).join('')}

                ${canvasElements.map((el) => {
                  const isSelected = state.selectedCanvasIds.has(el.id);
                  if (el.type === 'placeholder') {
                    const shapeCls = ['circle', 'rounded', 'semicircle', 'quartercircle'].includes(el.shape) ? `shape-${el.shape}` : '';
                    const brCss = getShapeBorderRadiusCss(el.shape, el.shapeAngle || 0, el.borderRadius ?? 14);
                    const brStyle = brCss ? `border-radius:${brCss};` : '';
                    const fCol = el.frameColor || '';
                    const fWidth = Math.max(1, Number(el.frameWidth) || 6);
                    const frameStyle = fCol ? `border:${fWidth}px solid ${escapeHtml(fCol)};` : '';
                    const shadowStyle = el.shadow === false ? 'box-shadow:none;' : (fCol ? 'box-shadow:var(--shadow-md);' : '');
                    const ovHtml = (el.overlayText && (el.overlayText.text || el.overlayText.heading))
                      ? `<div class="canvas-img-overlay-text">${renderTextContentHtml(el.overlayText)}</div>`
                      : '';
                    return `
                      <div class="canvas-item ${isSelected ? 'selected' : ''} ${shapeCls}"
                           data-canvas-id="${el.id}"
                           data-canvas-kind="el"
                           style="left:${el.x}px; top:${el.y}px; width:${el.w}px; height:${el.h}px; z-index:${el.z || 2}; ${brStyle} ${frameStyle} ${shadowStyle}">
                        <div class="canvas-el-placeholder" style="${brStyle}">
                          <span style="font-size:1.5rem;">🖼️</span>
                          <span>Platzhalter<br><span style="font-size:0.68rem;">Doppelklick für Bild</span></span>
                        </div>
                        ${ovHtml}
                        ${state.canvasLocked ? '' : '<div class="canvas-resize-handle" data-resize-handle="1"></div>'}
                      </div>
                    `;
                  }
                  if (el.type === 'line') {
                    const isVert = el.orientation === 'vertical';
                    const thick = Math.max(1, Number(el.thickness) || 2);
                    const lCol = el.color || '#262927';
                    return `
                      <div class="canvas-item ${isSelected ? 'selected' : ''}"
                           data-canvas-id="${el.id}"
                           data-canvas-kind="el"
                           style="left:${el.x}px; top:${el.y}px; width:${el.w}px; height:${el.h}px; z-index:${el.z || 15}; box-shadow:none; display:flex; align-items:center; justify-content:center;">
                        <div style="background:${escapeHtml(lCol)}; ${isVert ? `width:${thick}px; height:100%;` : `width:100%; height:${thick}px;`}"></div>
                        ${state.canvasLocked ? '' : '<div class="canvas-resize-handle" data-resize-handle="1"></div>'}
                      </div>
                    `;
                  }
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
                  const shapeCls = ['circle', 'semicircle', 'quartercircle'].includes(el.shape) ? `shape-${el.shape}` : (el.shape === 'pill' ? 'shape-rounded' : '');
                  const brCss = getShapeBorderRadiusCss(el.shape, el.shapeAngle || 0, el.borderRadius ?? 12);
                  const brStyle = brCss ? `border-radius:${brCss};` : '';
                  const fCol = el.frame ? (el.frameColor || '#FFFFFF') : '';
                  const frameStyle = fCol ? `border:6px solid ${escapeHtml(fCol)}; box-shadow:var(--shadow-md);` : '';
                  const bgStyle = el.shape === 'none' ? 'transparent' : (el.bgColor || '#262927');
                  const padStyle = ['circle', 'semicircle', 'quartercircle'].includes(el.shape) ? 'padding:14%;' : '';
                  return `
                    <div class="canvas-item ${isSelected ? 'selected' : ''} ${shapeCls}"
                         data-canvas-id="${el.id}"
                         data-canvas-kind="el"
                         style="left:${el.x}px; top:${el.y}px; width:${el.w}px; height:${el.h}px; z-index:${el.z || 10}; background-color:${escapeHtml(bgStyle)}; ${brStyle} ${frameStyle} ${el.shape === 'none' ? 'box-shadow:none;' : ''}">
                      <div class="canvas-el-text" style="${padStyle} justify-content:center;">${renderTextContentHtml(el)}</div>
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
          pushCanvasUndo(folderId);
          // Reihenfolge anhand aktueller visueller Position (Zeilenbänder auf Y, dann X) beibehalten
          const ordered = visualItems.slice().sort((a, b) => {
            const ay = Math.round((a.canvas.y || 0) / 110);
            const by = Math.round((b.canvas.y || 0) / 110);
            if (ay !== by) return ay - by;
            return (a.canvas.x || 0) - (b.canvas.x || 0);
          });
          layoutItemsToBoard(ordered, boardW, boardH);
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
            if (mode === 'free') {
              it.canvas.freeResize = true;
              if (!it.canvas.fitMode && fitMode === 'contain') it.canvas.fitMode = 'cover';
            } else {
              delete it.canvas.freeResize;
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
          allItems.forEach((it, idx) => {
            it.canvasHidden = false;
            if (!it.canvas) it.canvas = { x: 40, y: 40, w: 220, h: 210, z: idx + 1, _needsAutoAspect: true };
          });
          if (hasFixedBoard) {
            layoutItemsToBoard(allItems.filter((it) => !it.canvasHidden), boardW, boardH);
          }
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

        const getSelTiles = () => getAllBoxEntries().filter((e) => state.selectedCanvasIds.has(e.obj.id) && (e.kind === 'item' || e.obj.type === 'placeholder'));

        document.querySelectorAll('#canvasSelectionBar [data-sel-shape]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const shape = btn.getAttribute('data-sel-shape');
            for (const entry of getSelTiles()) {
              entry.box.shape = shape;
              if (shape === 'circle' || shape === 'quartercircle') {
                const size = Math.min(entry.box.w || 200, entry.box.h || 200);
                entry.box.w = size;
                entry.box.h = size;
              } else if (shape === 'semicircle') {
                const a = ((Number(entry.box.shapeAngle) || 0) % 360 + 360) % 360;
                if (a === 90 || a === 270) {
                  const baseH = Math.max(120, entry.box.h || 200);
                  entry.box.h = baseH;
                  entry.box.w = Math.max(60, Math.round(baseH / 2));
                } else {
                  const baseW = Math.max(120, entry.box.w || 220);
                  entry.box.w = baseW;
                  entry.box.h = Math.max(60, Math.round(baseW / 2));
                }
              }
            }
            scheduleBoardSave(folderId);
            renderCanvasView(container, statsEl, folderId);
          });
        });

        const selFrameBtn = document.getElementById('selFrameToggleBtn');
        if (selFrameBtn) selFrameBtn.addEventListener('click', () => {
          const selTiles = getSelTiles();
          const allFramed = selTiles.every((e) => !!(e.box.frameColor || e.box.frame === 'white'));
          selTiles.forEach((e) => {
            e.box.frameColor = allFramed ? '' : '#FFFFFF';
            delete e.box.frame;
          });
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        });

        bindHexColorPair(
          document.getElementById('selFrameColorInput'),
          document.getElementById('selFrameColorHex'),
          (col) => {
            getSelTiles().forEach((e) => {
              e.box.frameColor = col;
              delete e.box.frame;
              const fw = Math.max(1, Number(e.box.frameWidth) || 6);
              const el = stage.querySelector(`.canvas-item[data-canvas-id="${e.obj.id}"]`);
              if (el) el.style.border = `${fw}px solid ${col}`;
            });
            scheduleBoardSave(folderId);
          }
        );

        const selFrameWidthInp = document.getElementById('selFrameWidthInput');
        if (selFrameWidthInp) {
          selFrameWidthInp.addEventListener('input', () => {
            const fw = Math.max(1, Math.min(24, Number(selFrameWidthInp.value) || 6));
            getSelTiles().forEach((e) => {
              e.box.frameWidth = fw;
              if (!e.box.frameColor && e.box.frame !== 'white') e.box.frameColor = '#FFFFFF';
              const fCol = e.box.frameColor || '#FFFFFF';
              const el = stage.querySelector(`.canvas-item[data-canvas-id="${e.obj.id}"]`);
              if (el) el.style.border = `${fw}px solid ${fCol}`;
            });
          });
          selFrameWidthInp.addEventListener('change', () => scheduleBoardSave(folderId));
        }

        const selShadowBtn = document.getElementById('selShadowToggleBtn');
        if (selShadowBtn) selShadowBtn.addEventListener('click', () => {
          const selTiles = getSelTiles();
          const allOn = selTiles.every((e) => e.box.shadow !== false);
          selTiles.forEach((e) => { e.box.shadow = !allOn; });
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

        const selMoveInvBtn = document.getElementById('selMoveToInvBtn');
        if (selMoveInvBtn) selMoveInvBtn.addEventListener('click', () => {
          bulkMoveItemsToInventory(folderId, state.selectedCanvasIds);
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

        const selAssignPhBtn = document.getElementById('selAssignPlaceholderBtn');
        if (selAssignPhBtn) selAssignPhBtn.addEventListener('click', () => {
          const ph = canvasElements.find((e) => e.type === 'placeholder' && state.selectedCanvasIds.has(e.id));
          if (ph) openPlaceholderPickerModal(ph, folderId, container, statsEl);
        });

        const selRotateBtn = document.getElementById('selRotateShapeBtn');
        if (selRotateBtn) selRotateBtn.addEventListener('click', () => {
          pushCanvasUndo(folderId);
          getSelTiles().forEach((e) => {
            e.box.shapeAngle = ((Number(e.box.shapeAngle) || 0) + 90) % 360;
            if (e.box.shape === 'semicircle') {
              const oldW = e.box.w;
              e.box.w = e.box.h;
              e.box.h = oldW;
            }
          });
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        });

        const selRadiusInp = document.getElementById('selRadiusInput');
        if (selRadiusInp) {
          selRadiusInp.addEventListener('input', () => {
            const rad = Math.max(2, Math.min(140, Number(selRadiusInp.value) || 14));
            getSelTiles().forEach((e) => {
              e.box.borderRadius = rad;
              const el = stage.querySelector(`.canvas-item[data-canvas-id="${e.obj.id}"]`);
              if (el) el.style.borderRadius = `${rad}px`;
            });
          });
          selRadiusInp.addEventListener('change', () => scheduleBoardSave(folderId));
        }

        const selImgTextBtn = document.getElementById('selImgTextBtn');
        if (selImgTextBtn) selImgTextBtn.addEventListener('click', () => {
          const entry = getSelTiles()[0];
          if (!entry) return;
          if (!entry.box.overlayText) {
            entry.box.overlayText = {
              heading: '',
              headingStyle: 'serif',
              headingSize: 22,
              headingDivider: false,
              text: '',
              fontSize: 18,
              fontStyle: 'sans',
              textAlign: 'center',
              color: '#FFFFFF'
            };
          }
          openCanvasElementEditor({ ...entry.box.overlayText, type: 'text', _isImgOverlay: true, _targetBox: entry.box }, folderId, container, statsEl);
        });

        const boardPresetSel = document.getElementById('canvasBoardPresetSelect');
        if (boardPresetSel) boardPresetSel.addEventListener('change', (e) => {
          const v = e.target.value;
          if (!v) {
            saveCanvasSetting({ boardWidth: 0, boardHeight: 0 });
          } else {
            const [w, h] = v.split('x').map(Number);
            saveCanvasSetting({ boardWidth: w, boardHeight: h });
          }
          renderCanvasView(container, statsEl, folderId);
        });
        const boardWInp = document.getElementById('canvasBoardWInput');
        const boardHInp = document.getElementById('canvasBoardHInput');
        function applyCustomBoardSize() {
          const w = Number(boardWInp?.value) || 0;
          const h = Number(boardHInp?.value) || 0;
          if (w >= 300 && h >= 300) {
            saveCanvasSetting({ boardWidth: w, boardHeight: h });
            renderCanvasView(container, statsEl, folderId);
          }
        }
        if (boardWInp) boardWInp.addEventListener('change', applyCustomBoardSize);
        if (boardHInp) boardHInp.addEventListener('change', applyCustomBoardSize);
        const boardFreeBtn = document.getElementById('canvasBoardFreeBtn');
        if (boardFreeBtn) boardFreeBtn.addEventListener('click', () => {
          saveCanvasSetting({ boardWidth: 0, boardHeight: 0 });
          renderCanvasView(container, statsEl, folderId);
        });

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

        document.getElementById('canvasTemplatesBtn').addEventListener('click', () => {
          openTemplatesModal(folderId, container, statsEl);
        });

        document.getElementById('canvasAddPlaceholderBtn').addEventListener('click', () => {
          const all = getAllBoxEntries();
          const maxZ = Math.max(1, ...all.map((e) => (e.box && e.box.z) || 1));
          const newEl = {
            id: uid('cel'),
            type: 'placeholder',
            x: Math.round((viewport.scrollLeft + 100) / state.canvasZoom),
            y: Math.round((viewport.scrollTop + 100) / state.canvasZoom),
            w: 220,
            h: 220,
            z: maxZ + 1,
            shape: 'rect'
          };
          pushCanvasUndo(folderId);
          content.board.canvasElements.push(newEl);
          state.selectedCanvasIds = new Set([newEl.id]);
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        });

        document.getElementById('canvasAiLayoutBtn').addEventListener('click', () => {
          if (visualItems.length === 0) {
            uiAlert('Bitte füge zuerst mindestens ein Bild oder Element zum Moodboard hinzu.');
            return;
          }
          const heroSel = document.getElementById('aiLayoutHeroSelect');
          if (heroSel) {
            heroSel.innerHTML = `<option value="">✨ KI wählt automatisch</option>` +
              visualItems.map((it) => {
                const res = resolveBoardItem(it, folderId);
                return `<option value="${escapeHtml(it.id)}">${escapeHtml(res.title || 'Bild')}</option>`;
              }).join('');
          }
          document.getElementById('aiLayoutRunBtn').onclick = async () => {
            const keepFormatting = document.getElementById('aiLayoutKeepFormatCb').checked;
            const keepElements = document.getElementById('aiLayoutKeepElementsCb').checked;
            const heroId = document.getElementById('aiLayoutHeroSelect')?.value || '';
            const layoutStyle = document.getElementById('aiLayoutStyleSelect')?.value || 'auto';
            const styleHint = document.getElementById('aiLayoutHintInput')?.value.trim() || '';
            closeModal('aiLayoutModal');
            await generateAiMoodboardLayout(folderId, visualItems, content, stage, container, statsEl, { keepFormatting, keepElements, heroId, layoutStyle, styleHint });
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

        document.getElementById('canvasAddLineBtn').addEventListener('click', () => {
          const all = getAllBoxEntries();
          const maxZ = Math.max(1, ...all.map((e) => (e.box && e.box.z) || 1));
          const newEl = {
            id: uid('cel'),
            type: 'line',
            orientation: 'horizontal',
            thickness: 2,
            color: '#262927',
            x: Math.round((viewport.scrollLeft + 100) / state.canvasZoom),
            y: Math.round((viewport.scrollTop + 140) / state.canvasZoom),
            w: 360,
            h: 18,
            z: maxZ + 1
          };
          content.board.canvasElements.push(newEl);
          state.selectedCanvasIds = new Set([newEl.id]);
          scheduleBoardSave(folderId);
          renderCanvasView(container, statsEl, folderId);
        });

        document.getElementById('canvasExportPngBtn').addEventListener('click', () => {
          exportCanvasToPng(folderId, visualItems, canvasElements, bgColor, bgMode, fitMode, stage, boardW, boardH);
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
          if (!el) return;
          if (el.type === 'placeholder') {
            openPlaceholderPickerModal(el, folderId, container, statsEl);
          } else {
            openCanvasElementEditor(el, folderId, container, statsEl);
          }
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
          const aspectRatio = box.freeResize
            ? 0
            : (box.shape === 'circle'
                ? 1
                : (kind === 'item' ? ((box.h || 200) / Math.max(1, box.w || 200)) : 0));

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
        if (el.type === 'line') {
          document.getElementById('clOrientationSelect').value = el.orientation || 'horizontal';
          document.getElementById('clThicknessInput').value = el.thickness || 2;
          const lCol = (el.color || '#262927').toUpperCase();
          document.getElementById('clColorInput').value = lCol;
          document.getElementById('clColorHex').value = lCol;
          bindHexColorPair(document.getElementById('clColorInput'), document.getElementById('clColorHex'), () => {});
          document.getElementById('clSaveBtn').onclick = () => {
            const nextOri = document.getElementById('clOrientationSelect').value;
            if ((el.orientation || 'horizontal') !== nextOri) {
              const oldW = el.w;
              el.w = Math.max(18, el.h);
              el.h = Math.max(18, oldW);
            }
            el.orientation = nextOri;
            el.thickness = Math.max(1, Math.min(24, Number(document.getElementById('clThicknessInput').value) || 2));
            el.color = document.getElementById('clColorInput').value;
            scheduleBoardSave(folderId);
            closeModal('canvasLineModal');
            renderCanvasView(container, statsEl, folderId);
          };
          openModal('canvasLineModal');
        } else if (el.type === 'text') {
          const isImgOv = !!el._isImgOverlay;
          const shapeGrp = document.getElementById('ctShapeGroup');
          if (shapeGrp) shapeGrp.style.display = isImgOv ? 'none' : '';
          document.getElementById('ctHeadingInput').value = el.heading || '';
          document.getElementById('ctHeadingStyleSelect').value = el.headingStyle || 'serif';
          document.getElementById('ctHeadingSizeInput').value = el.headingSize || 22;
          document.getElementById('ctHeadingDividerCb').checked = !!el.headingDivider;
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
            const heading = document.getElementById('ctHeadingInput').value.trim();
            const headingStyle = document.getElementById('ctHeadingStyleSelect').value;
            const headingSize = Math.max(12, Math.min(96, Number(document.getElementById('ctHeadingSizeInput').value) || 22));
            const headingDivider = document.getElementById('ctHeadingDividerCb').checked;
            const text = document.getElementById('ctTextInput').value;
            const fontStyle = document.getElementById('ctFontSelect').value;
            const textAlign = document.getElementById('ctAlignSelect').value;
            const fontSize = Math.max(12, Math.min(96, Number(document.getElementById('ctFontSizeInput').value) || 24));
            const color = document.getElementById('ctColorInput').value;

            const targetBox = el._targetBox || (el._targetItem && el._targetItem.canvas);
            if (isImgOv && targetBox) {
              if (!heading && !text.trim()) {
                delete targetBox.overlayText;
              } else {
                targetBox.overlayText = { heading, headingStyle, headingSize, headingDivider, text, fontStyle, textAlign, fontSize, color };
              }
            } else {
              el.heading = heading;
              el.headingStyle = headingStyle;
              el.headingSize = headingSize;
              el.headingDivider = headingDivider;
              el.text = text || (heading ? '' : 'Text');
              el.shape = document.getElementById('ctShapeSelect').value;
              el.fontStyle = fontStyle;
              el.textAlign = textAlign;
              el.fontSize = fontSize;
              el.color = color;
              el.bgColor = document.getElementById('ctBgColorInput').value;
              el.frame = document.getElementById('ctWhiteFrameCb').checked;
              el.frameColor = document.getElementById('ctFrameColorInput').value;
              if (el.shape === 'circle') {
                const s = Math.max(120, Math.min(el.w, el.h) < 120 ? 160 : el.w);
                el.w = s;
                el.h = s;
              }
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

      function drawWrappedTextBlockOnCtx(ctx, el, x, y, bw, bh) {
        const align = el.textAlign || 'center';
        const col = el.color || '#262927';
        const padX = ['circle', 'semicircle', 'quartercircle'].includes(el.shape) ? Math.round(bw * 0.14) : 12;
        const maxTextW = Math.max(40, bw - padX * 2);
        const tx = align === 'left' ? x + padX : (align === 'right' ? x + bw - padX : x + bw / 2);

        const wrapParagraphs = (str, fontStr, fs) => {
          ctx.font = fontStr;
          const out = [];
          for (const para of String(str || '').split('\n')) {
            if (!para.trim()) { out.push(''); continue; }
            let cur = '';
            for (const word of para.split(/\s+/)) {
              const test = cur ? `${cur} ${word}` : word;
              if (ctx.measureText(test).width <= maxTextW) cur = test;
              else { if (cur) out.push(cur); cur = word; }
            }
            if (cur) out.push(cur);
          }
          return out.map((t) => ({ text: t, font: fontStr, lh: fs * 1.2 }));
        };

        const rows = [];
        if (el.heading) {
          const hs = Number(el.headingSize) || 22;
          const hStyle = el.headingStyle || 'serif';
          const hFam = hStyle === 'serif' ? 'Georgia, serif' : 'system-ui, sans-serif';
          const hText = hStyle === 'uppercase' ? el.heading.toUpperCase() : el.heading;
          const hLines = wrapParagraphs(hText, `${hStyle === 'outline' ? '800' : '700'} ${hs}px ${hFam}`, hs);
          hLines.forEach((l) => rows.push({ ...l, isOutline: hStyle === 'outline' }));
          if (el.headingDivider) rows.push({ divider: true, lh: 10 });
        }
        if (el.text) {
          const fs = Number(el.fontSize) || 24;
          const fam = el.fontStyle === 'serif' ? 'Georgia, serif' : 'system-ui, sans-serif';
          const bLines = wrapParagraphs(el.text, `${el.fontStyle === 'outline' ? '800' : '500'} ${fs}px ${fam}`, fs);
          bLines.forEach((l) => rows.push({ ...l, isOutline: el.fontStyle === 'outline' }));
        }
        if (rows.length === 0) return;

        const totalH = rows.reduce((s, r) => s + r.lh, 0);
        let curY = y + (bh - totalH) / 2;
        ctx.textAlign = align;
        ctx.textBaseline = 'middle';
        for (const r of rows) {
          if (r.divider) {
            ctx.save();
            ctx.strokeStyle = col;
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + padX, curY + r.lh / 2);
            ctx.lineTo(x + bw - padX, curY + r.lh / 2);
            ctx.stroke();
            ctx.restore();
          } else {
            ctx.font = r.font;
            const cy = curY + r.lh / 2;
            if (r.isOutline) {
              ctx.strokeStyle = col;
              ctx.lineWidth = 1.5;
              ctx.strokeText(r.text, tx, cy);
            } else {
              ctx.fillStyle = col;
              ctx.fillText(r.text, tx, cy);
            }
          }
          curY += r.lh;
        }
      }

      async function exportCanvasToPng(folderId, visualItems, canvasElements, bgColor, bgMode, fitMode, stage, fixedW = 0, fixedH = 0) {
        const entries = [
          ...visualItems.map((it) => ({ kind: 'item', obj: it, box: it.canvas })),
          ...canvasElements.map((el) => ({ kind: 'el', obj: el, box: el }))
        ].sort((a, b) => (a.box.z || 1) - (b.box.z || 1));

        if (entries.length === 0) return;
        showSyncStatus('Erstelle Moodboard-PNG…', true);
        const hasFixed = fixedW > 0 && fixedH > 0;
        const pad = hasFixed ? 0 : 40;
        const minX = hasFixed ? 0 : Math.min(...entries.map((e) => e.box.x || 0));
        const minY = hasFixed ? 0 : Math.min(...entries.map((e) => e.box.y || 0));
        const maxX = hasFixed ? fixedW : Math.max(...entries.map((e) => (e.box.x || 0) + (e.box.w || 200)));
        const maxY = hasFixed ? fixedH : Math.max(...entries.map((e) => (e.box.y || 0) + (e.box.h || 200)));
        const scale = 2;
        const w = hasFixed ? fixedW : Math.max(400, (maxX - minX) + pad * 2);
        const h = hasFixed ? fixedH : Math.max(300, (maxY - minY) + pad * 2);

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
            traceShapePathOnCtx(ctx, x, y, bw, bh, e.box.shape || 'rect', e.box.shapeAngle || 0, e.box.borderRadius ?? 14);
            ctx.clip();
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
            if (e.box.overlayText && (e.box.overlayText.text || e.box.overlayText.heading)) {
              drawWrappedTextBlockOnCtx(ctx, { ...e.box.overlayText, shape: e.box.shape }, x, y, bw, bh);
            }
            ctx.restore();
            const fCol = e.box.frameColor || (e.box.frame === 'white' ? '#FFFFFF' : '');
            const fw = Math.max(1, Number(e.box.frameWidth) || 6);
            if (fCol) {
              ctx.save();
              ctx.strokeStyle = fCol;
              ctx.lineWidth = fw;
              traceShapePathOnCtx(ctx, x + fw / 2, y + fw / 2, bw - fw, bh - fw, e.box.shape || 'rect', e.box.shapeAngle || 0, e.box.borderRadius ?? 14);
              ctx.stroke();
              ctx.restore();
            }
          } else if (e.obj.type === 'line') {
            ctx.save();
            ctx.fillStyle = e.obj.color || '#262927';
            const thick = Math.max(1, Number(e.obj.thickness) || 2);
            if (e.obj.orientation === 'vertical') {
              ctx.fillRect(x + (bw - thick) / 2, y, thick, bh);
            } else {
              ctx.fillRect(x, y + (bh - thick) / 2, bw, thick);
            }
            ctx.restore();
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
          } else if (e.obj.type === 'placeholder') {
            ctx.save();
            traceShapePathOnCtx(ctx, x, y, bw, bh, e.obj.shape || 'rect', e.obj.shapeAngle || 0, e.obj.borderRadius ?? 14);
            ctx.fillStyle = '#EFECE5';
            ctx.fill();
            ctx.strokeStyle = '#B8B0A0';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
            if (e.obj.overlayText && (e.obj.overlayText.text || e.obj.overlayText.heading)) {
              drawWrappedTextBlockOnCtx(ctx, { ...e.obj.overlayText, shape: e.obj.shape }, x, y, bw, bh);
            }
            ctx.restore();
          } else if (e.obj.type === 'text') {
            ctx.save();
            const tfCol = e.obj.frameColor || '#FFFFFF';
            if (e.obj.shape && e.obj.shape !== 'none') {
              traceShapePathOnCtx(ctx, x, y, bw, bh, e.obj.shape, e.obj.shapeAngle || 0, e.obj.borderRadius ?? 12);
              ctx.fillStyle = e.obj.bgColor || '#262927';
              ctx.fill();
              if (e.obj.frame) { ctx.strokeStyle = tfCol; ctx.lineWidth = 6; ctx.stroke(); }
            }
            drawWrappedTextBlockOnCtx(ctx, e.obj, x, y, bw, bh);
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

      function buildEditorialGridPlan(visualItems, director, projectTitle, fallbackPalette, keepFormatting = false, opts = {}) {
        const { heroId = '', layoutStyle = 'auto', projectLead = '', projectEyebrow = '', aspectWtoHMap = new Map() } = opts;
        const gap = 14;
        const startX = 40;
        let curY = 40;

        const idMap = new Map(visualItems.map((it) => [it.id, it]));
        const getImgAr = (id) => {
          if (aspectWtoHMap.has(id)) return aspectWtoHMap.get(id);
          const it = idMap.get(id);
          return (it && it.canvas && it.canvas.w && it.canvas.h) ? (it.canvas.w / it.canvas.h) : 1;
        };
        const orderedIds = Array.isArray(director.orderedIds)
          ? director.orderedIds.filter((id) => idMap.has(id))
          : [];
        for (const it of visualItems) {
          if (!orderedIds.includes(it.id)) orderedIds.push(it.id);
        }

        const validStyles = ['collage-wide', 'brand-header', 'vision-board', 'minimalist-tall', 'hero-left', 'hero-right'];
        const chosenStyle = layoutStyle !== 'auto' && validStyles.includes(layoutStyle)
          ? layoutStyle
          : (validStyles.includes(director.layoutStyle) ? director.layoutStyle : validStyles[Math.floor(Math.random() * validStyles.length)]);

        const isWide = ['collage-wide', 'brand-header', 'vision-board'].includes(chosenStyle);
        const isPanorama = ['collage-wide', 'brand-header'].includes(chosenStyle);
        const boardW = isPanorama ? 1440 : (isWide ? 1140 : 840);

        const cropsMap = (director && typeof director.crops === 'object' && director.crops) ? director.crops : {};
        const canCropId = (id) => {
          const c = cropsMap[id];
          return c && c.canCrop === false ? false : true;
        };

        let circleSet;
        if (keepFormatting) {
          circleSet = new Set(orderedIds.filter((id) => {
            const it = idMap.get(id);
            return it && it.canvas && it.canvas.shape === 'circle';
          }));
        } else if (['brand-header', 'vision-board'].includes(chosenStyle)) {
          circleSet = new Set();
        } else {
          circleSet = new Set(
            (Array.isArray(director.circleIds) ? director.circleIds : [])
              .filter((id) => idMap.has(id) && id !== heroId && canCropId(id))
              .slice(0, 2)
          );
          if (circleSet.size === 0 && orderedIds.length >= 6) {
            const fallbackCircle = orderedIds.find((id) => id !== heroId && canCropId(id)) || orderedIds.find((id) => id !== heroId);
            if (fallbackCircle && fallbackCircle !== heroId) circleSet.add(fallbackCircle);
          }
        }

        let gridIds = orderedIds.filter((id) => !circleSet.has(id));
        // Bei festen Hero- oder Top-Reihen-Slots: canCrop=true-Bilder bevorzugen, damit canCrop=false-Objekte in passgenaue Reihen wandern
        if (!heroId) {
          const croppable = gridIds.filter((id) => canCropId(id));
          const nonCroppable = gridIds.filter((id) => !canCropId(id));
          if (croppable.length >= 3) gridIds = [...croppable, ...nonCroppable];
        }
        if (heroId && idMap.has(heroId)) {
          circleSet.delete(heroId);
          gridIds = [heroId, ...gridIds.filter((id) => id !== heroId)];
        }

        const swatchHexes = Array.isArray(director.prioritySwatches) ? director.prioritySwatches : [];
        const rawPal = [
          ...swatchHexes,
          ...(Array.isArray(director.palette) ? director.palette : []),
          ...fallbackPalette
        ].map((h) => String(h || '').toUpperCase()).filter((h) => /^#[0-9A-F]{6}$/.test(h));
        const palColors = Array.from(new Set(rawPal)).slice(0, Math.max(5, Math.min(7, swatchHexes.length || 5)));

        const itemsLayout = [];
        const elements = [];
        let zCounter = 1;

        function layoutRow(rowIds, forcedH = null, rowX = startX, rowW = boardW) {
          if (rowIds.length === 0) return;
          const totalGap = gap * (rowIds.length - 1);
          const availW = rowW - totalGap;
          const aspects = rowIds.map((id) => Math.max(0.45, Math.min(2.1, getImgAr(id))));
          const sumAr = aspects.reduce((s, a) => s + a, 0);
          const rowH = forcedH || Math.max(95, Math.min(460, Math.round(availW / sumAr)));
          let curX = rowX;
          rowIds.forEach((id, idx) => {
            const isLast = idx === rowIds.length - 1;
            const w = isLast ? (rowX + rowW - curX) : Math.round((aspects[idx] / sumAr) * availW);
            itemsLayout.push({ id, x: curX, y: curY, w, h: rowH, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
            curX += w + gap;
          });
          curY += rowH + gap;
        }

        function layoutRemainingRows(remIds, perRowMax = isPanorama ? 6 : (isWide ? 4 : 3)) {
          const targetMinH = isPanorama ? 155 : (isWide ? 180 : 175);
          const targetMaxH = isPanorama ? 245 : (isWide ? 290 : 290);
          let rIdx = 0;
          while (rIdx < remIds.length) {
            const remaining = remIds.length - rIdx;
            if (remaining <= 2) {
              layoutRow(remIds.slice(rIdx));
              break;
            }
            let chosenCount = Math.min(perRowMax, remaining);
            if (remaining >= 6 && remaining <= 8 && perRowMax >= 5) {
              chosenCount = Math.ceil(remaining / 2);
            } else {
              for (let c = 2; c <= Math.min(perRowMax, remaining); c++) {
                // Vermeide, dass genau 1 oder 2 Bilder am Ende übrig bleiben
                if (remaining - c === 1 || (remaining >= 5 && remaining - c === 2)) continue;
                const slice = remIds.slice(rIdx, rIdx + c);
                const sumAr = slice.reduce((s, id) => s + Math.max(0.45, Math.min(2.1, getImgAr(id))), 0);
                const estH = (boardW - gap * (c - 1)) / sumAr;
                chosenCount = c;
                if (estH <= targetMaxH && estH >= targetMinH) break;
                if (estH < targetMinH) {
                  chosenCount = Math.max(2, c - 1);
                  if ((remaining - chosenCount === 1 || (remaining >= 5 && remaining - chosenCount === 2)) && c <= remaining) chosenCount = c;
                  break;
                }
              }
            }
            if (remaining - chosenCount === 1 && chosenCount > 2) chosenCount--;
            layoutRow(remIds.slice(rIdx, rIdx + chosenCount));
            rIdx += chosenCount;
          }
        }

        if (chosenStyle === 'collage-wide') {
          // Beispiel 1: 5 hohe Farbstreifen oben links, reinweißer Hintergrund (#FFFFFF) & überlappende Collage-Elemente
          const palW = 320;
          const topH = 220;
          elements.push({
            id: uid('cel'),
            type: 'palette',
            x: startX,
            y: curY,
            w: palW,
            h: topH,
            z: 18,
            colors: palColors.slice(0, 5),
            shape: 'rect',
            orientation: 'horizontal'
          });
          const topCount = Math.min(3, gridIds.length);
          if (topCount > 0) {
            layoutRow(gridIds.slice(0, topCount), topH, startX + palW + gap, boardW - palW - gap);
          } else {
            curY += topH + gap;
          }
          layoutRemainingRows(gridIds.slice(topCount), 6);
          // Leichte weiße Collage-Ränder & leichte Überlappung bei einem Akzentbild
          itemsLayout.forEach((it) => {
            it.frameColor = '#FFFFFF';
            it.frameWidth = 6;
            it.shadow = false;
          });
          if (itemsLayout.length >= 5) {
            const overlapTile = itemsLayout[3];
            overlapTile.y = Math.max(40, overlapTile.y - 26);
            overlapTile.z = 22;
          }
          const circleList = Array.from(circleSet);
          if (circleList[0]) {
            itemsLayout.push({ id: circleList[0], x: startX + Math.round(boardW * 0.62), y: 120, w: 195, h: 195, z: 24, shape: 'circle', frameColor: '#FFFFFF', frameWidth: 8, shadow: false });
          }
          if (circleList[1]) {
            itemsLayout.push({ id: circleList[1], x: startX + Math.round(boardW * 0.24), y: Math.max(180, curY - 215), w: 185, h: 185, z: 25, shape: 'circle', frameColor: '#FFFFFF', frameWidth: 8, shadow: false });
          }
          return { bgColor: '#FFFFFF', collageMode: true, items: itemsLayout, elements };
        }

        if (chosenStyle === 'brand-header') {
          // Beispiel 3: Panorama Brand-Header (Titel + runde Mini-Swatches + Leitidee) über dichtem 5-6er Panorama-Raster
          const headerH = 88;
          elements.push({
            id: uid('cel'),
            type: 'text',
            x: startX,
            y: curY,
            w: 250,
            h: headerH,
            z: 20,
            text: director.badgeText || projectTitle || 'Moodboard',
            fontSize: 30,
            fontStyle: 'serif',
            textAlign: 'left',
            color: '#262927',
            bgColor: '#FFFFFF',
            shape: 'none',
            frame: false
          });
          elements.push({
            id: uid('cel'),
            type: 'palette',
            x: startX + 265,
            y: curY + 26,
            w: 240,
            h: 36,
            z: 20,
            colors: palColors.slice(0, 5),
            shape: 'circle',
            orientation: 'horizontal'
          });
          elements.push({
            id: uid('cel'),
            type: 'text',
            x: startX + 525,
            y: curY,
            w: boardW - 525,
            h: headerH,
            z: 20,
            text: projectLead || projectEyebrow || 'Stimmung, Farben & Materialien für dieses Projekt.',
            fontSize: 15,
            fontStyle: 'sans',
            textAlign: 'left',
            color: '#4E5350',
            bgColor: '#FFFFFF',
            shape: 'none',
            frame: false
          });
          curY += headerH + gap + 4;
          layoutRemainingRows(gridIds, 6);
          return { bgColor: director.bgColor || '#FFFFFF', collageMode: true, items: itemsLayout, elements };
        }

        if (chosenStyle === 'vision-board') {
          // Beispiel 4: Senkrechte Swatch-Spalte links + Hero-Stapel + Mittel-Spalte + farbiger Textblock rechts unten
          const swW = 105;
          const totalH = 520;
          elements.push({
            id: uid('cel'),
            type: 'palette',
            x: startX,
            y: curY,
            w: swW,
            h: totalH,
            z: 18,
            colors: palColors.slice(0, 6),
            shape: 'rect',
            orientation: 'vertical'
          });
          const bodyX = startX + swW + gap;
          const bodyW = boardW - swW - gap;
          const c1W = Math.round(bodyW * 0.32);
          const c2W = Math.round(bodyW * 0.22);
          const c3W = bodyW - c1W - c2W - gap * 2;
          const h1 = 275;
          const h2 = totalH - h1 - gap;
          if (gridIds[0]) itemsLayout.push({ id: gridIds[0], x: bodyX, y: curY, w: c1W, h: h1, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          if (gridIds[1]) itemsLayout.push({ id: gridIds[1], x: bodyX, y: curY + h1 + gap, w: c1W, h: h2, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          if (gridIds[2]) itemsLayout.push({ id: gridIds[2], x: bodyX + c1W + gap, y: curY, w: c2W, h: totalH, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });

          const c3X = bodyX + c1W + gap + c2W + gap;
          const top3H = 210;
          const half3W = Math.round((c3W - gap) / 2);
          if (gridIds[3]) itemsLayout.push({ id: gridIds[3], x: c3X, y: curY, w: half3W, h: top3H, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          if (gridIds[4]) itemsLayout.push({ id: gridIds[4], x: c3X + half3W + gap, y: curY, w: c3W - half3W - gap, h: top3H, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });

          const accentBg = (director.badgeBg && /^#[0-9a-fA-F]{6}$/.test(director.badgeBg)) ? director.badgeBg : (palColors[2] || '#4F6D5A');
          const boxTitle = (director.badgeText || projectTitle || 'VISION BOARD').toUpperCase();
          const boxBody = projectLead || projectEyebrow || 'Leitidee & Materialien';
          elements.push({
            id: uid('cel'),
            type: 'text',
            x: c3X,
            y: curY + top3H + gap,
            w: c3W,
            h: totalH - top3H - gap,
            z: 22,
            text: `${boxTitle}\n\n${boxBody}`,
            fontSize: 17,
            fontStyle: 'serif',
            textAlign: 'left',
            color: '#FFFFFF',
            bgColor: accentBg,
            shape: 'pill',
            frame: false
          });
          curY += totalH + gap;
          layoutRemainingRows(gridIds.slice(5), 4);
          return { bgColor: director.bgColor || '#FFFFFF', collageMode: true, items: itemsLayout, elements };
        }

        // Bestehende Hochkant-/Editorial-Stile (minimalist-tall, hero-left, hero-right)
        let cursor = 0;
        let heroSplitX = startX + Math.round(boardW * 0.58);
        if (chosenStyle === 'minimalist-tall' && gridIds.length >= 4) {
          const leftTotalW = Math.round(boardW * 0.65);
          const rightW = boardW - leftTotalW - gap;
          const topH = 200;
          const midH = 260;
          const tallH = topH + gap + midH;
          const halfLeftW = Math.round((leftTotalW - gap) / 2);
          itemsLayout.push({ id: gridIds[0], x: startX, y: curY, w: leftTotalW, h: topH, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          itemsLayout.push({ id: gridIds[1], x: startX, y: curY + topH + gap, w: halfLeftW, h: midH, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          itemsLayout.push({ id: gridIds[2], x: startX + halfLeftW + gap, y: curY + topH + gap, w: leftTotalW - halfLeftW - gap, h: midH, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          itemsLayout.push({ id: gridIds[3], x: startX + leftTotalW + gap, y: curY, w: rightW, h: tallH, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          curY += tallH + gap;
          cursor = 4;
          heroSplitX = startX + halfLeftW;
        } else if (chosenStyle === 'hero-right' && gridIds.length >= 3) {
          const rightW = Math.round(boardW * 0.58) - Math.round(gap / 2);
          const leftW = boardW - rightW - gap;
          const heroH = 340;
          const subH = Math.round((heroH - gap) / 2);
          itemsLayout.push({ id: gridIds[1], x: startX, y: curY, w: leftW, h: subH, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          itemsLayout.push({ id: gridIds[2], x: startX, y: curY + subH + gap, w: leftW, h: heroH - subH - gap, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          itemsLayout.push({ id: gridIds[0], x: startX + leftW + gap, y: curY, w: rightW, h: heroH, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          curY += heroH + gap;
          cursor = 3;
          heroSplitX = startX + leftW;
        } else if (gridIds.length >= 3) {
          const leftW = Math.round(boardW * 0.58) - Math.round(gap / 2);
          const rightW = boardW - leftW - gap;
          const heroH = 340;
          const subH = Math.round((heroH - gap) / 2);
          itemsLayout.push({ id: gridIds[0], x: startX, y: curY, w: leftW, h: heroH, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          itemsLayout.push({ id: gridIds[1], x: startX + leftW + gap, y: curY, w: rightW, h: subH, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          itemsLayout.push({ id: gridIds[2], x: startX + leftW + gap, y: curY + subH + gap, w: rightW, h: heroH - subH - gap, z: zCounter++, shape: 'rect', frameColor: '', shadow: false });
          curY += heroH + gap;
          cursor = 3;
          heroSplitX = startX + leftW;
        }

        const paletteY = curY;
        elements.push({
          id: uid('cel'),
          type: 'palette',
          x: startX,
          y: paletteY,
          w: boardW,
          h: 54,
          z: 18,
          colors: palColors.slice(0, 5),
          shape: 'rect',
          orientation: 'horizontal'
        });
        curY += 54 + gap;

        layoutRemainingRows(gridIds.slice(cursor), 3);

        const circleList = Array.from(circleSet);
        if (circleList[0]) {
          itemsLayout.push({ id: circleList[0], x: heroSplitX - 85, y: Math.max(40, paletteY - 125), w: 170, h: 170, z: 24, shape: 'circle', frameColor: '#FFFFFF', frameWidth: 6, shadow: true });
        }
        if (circleList[1] && curY > paletteY + 200) {
          itemsLayout.push({ id: circleList[1], x: startX + Math.round(boardW * 0.33) - 80, y: paletteY + 145, w: 160, h: 160, z: 25, shape: 'circle', frameColor: '#FFFFFF', frameWidth: 6, shadow: true });
        }

        const badgeX = chosenStyle === 'hero-right' ? (startX + boardW - 180) : (chosenStyle === 'minimalist-tall' ? (heroSplitX - 78) : (startX + 24));
        const badgeY = chosenStyle === 'minimalist-tall' ? 160 : (paletteY - 115);
        elements.push({
          id: uid('cel'),
          type: 'text',
          x: badgeX,
          y: Math.max(40, badgeY),
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
        const { keepFormatting = false, keepElements = false, heroId = '', layoutStyle = 'auto', styleHint = '' } = opts;
        if (visualItems.length === 0) {
          await uiAlert('Bitte füge zuerst mindestens ein Bild oder Element zum Moodboard hinzu.');
          return;
        }
        const { geminiKey } = getSettings();
        const folder = state.folders.find((f) => f.id === folderId);
        let home = content.board.projectHome || {};

        // Falls wir in einem Unterordner sind: Swatches, Leitidee & Eyebrow vom übergeordneten Hauptprojekt erben
        if (!Array.isArray(home.swatches) || home.swatches.length === 0 || !home.lead) {
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
              if (aHome) {
                home = {
                  ...aHome,
                  ...home,
                  swatches: (Array.isArray(home.swatches) && home.swatches.length > 0) ? home.swatches : (aHome.swatches || []),
                  lead: home.lead || aHome.lead || '',
                  eyebrow: home.eyebrow || aHome.eyebrow || ''
                };
                if (home.swatches.length > 0 && home.lead) break;
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

        const aspectWtoHMap = new Map();
        visualItems.forEach((it) => {
          const imgEl = stage.querySelector(`.canvas-item[data-canvas-id="${it.id}"] img`);
          const ar = (imgEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0)
            ? (imgEl.naturalWidth / imgEl.naturalHeight)
            : ((it.canvas.w || 200) / Math.max(1, it.canvas.h || 200));
          aspectWtoHMap.set(it.id, ar);
        });

        let director = {};
        if (geminiKey) {
          showSyncStatus('✨ KI sichtet Bilder & kuratiert Layout…', true);
          try {
            const extraParts = [];
            const itemInfos = visualItems.map((it, idx) => {
              const resolved = resolveBoardItem(it, folderId);
              const imgEl = stage.querySelector(`.canvas-item[data-canvas-id="${it.id}"] img`);
              const arHtoW = +(1 / Math.max(0.2, aspectWtoHMap.get(it.id) || 1)).toFixed(2);
              if (idx < 16 && imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
                try {
                  const tc = document.createElement('canvas');
                  const sc = Math.min(1, 180 / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
                  tc.width = Math.max(1, Math.round(imgEl.naturalWidth * sc));
                  tc.height = Math.max(1, Math.round(imgEl.naturalHeight * sc));
                  tc.getContext('2d').drawImage(imgEl, 0, 0, tc.width, tc.height);
                  const b64 = tc.toDataURL('image/jpeg', 0.65).split(',')[1];
                  if (b64) {
                    extraParts.push({ text: `Bild ${it.id}:` });
                    extraParts.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } });
                  }
                } catch (ce) {}
              }
              return {
                id: it.id,
                title: resolved.title || 'Element',
                tags: resolved.tags || [],
                aspectRatioHtoW: arHtoW,
                colors: (resolved.ai && resolved.ai.colorNames) ? resolved.ai.colorNames : []
              };
            });

            const prompt = `Du bist Creative Director für Editorial-Moodboards. Unten siehst du die Metadaten und verkleinerte Vorschaubilder. Kuratiere die Reihenfolge, Highlights und Stilwahl (das exakte Raster berechnet danach unsere Layout-Engine, du gibst KEINE Pixelkoordinaten aus).
Projekt: ${JSON.stringify({ title: projectTitle, eyebrow: home.eyebrow || '', lead: home.lead || '', swatches: home.swatches || [], extractedColors: fallbackPalette })}
Bilder: ${JSON.stringify(itemInfos)}
Regeln:
- "layoutStyle": Wähle passend zu Projekt, Bildern und Stil-Hinweis eine dieser 6 Vorlagen: "collage-wide" (quer mit vertikaler Palette links & überlappenden Kreisen), "brand-header" (quer mit Header-Zeile oben & dichtem Raster), "vision-board" (quer mit vertikaler Swatch-Spalte links & farbigem Textblock), "minimalist-tall" (hochkant mit hoher rechter Spalte), "hero-left", "hero-right".${styleHint ? ` Nutzerwunsch / Stil-Hinweis: "${styleHint}".` : ''}
- "orderedIds": Alle Bild-IDs in harmonischer Reihenfolge. Das ERSTE Bild ist das große Hero-Bild (wähle anhand der Vorschaubilder ein stimmungsvolles Szene-/Ambiente-Foto, KEIN weißes freigestelltes Einzelobjekt).${heroId ? ` WICHTIG: Das Bild "${heroId}" ist fest als Hero-Bild gewählt und MUSS an erster Stelle stehen.` : ''} Gruppiere ähnliche Stimmungen/Farbwerte (z. B. dunkle Ambiente-Fotos vs. helle Produktfotos) sauber zusammen.
- "circleIds": 1-2 IDs von Detail-/Akzentbildern mit canCrop=true, die als runde Kreis-Ausschnitte hervorgehoben werden.
- "crops": Objekt je Bild-ID: { "<id>": { "canCrop": true|false, "focusX": 0-100, "focusY": 0-100 } }. Setze "canCrop": false bei freigestellten Objekten/Möbeln/Figuren, bei denen nichts abgeschnitten werden darf; "canCrop": true bei Szenen/Texturen. "focusX"/"focusY" markiert in Prozent das Hauptmotiv (z. B. Gesicht/Figur statt nur Hintergrund oder Mützenspitze).
- "bgColor": Eine sehr dezente, helle Hintergrundfarbe als Hex passend zum Thema (z. B. "#F6F2EA", "#F3F5F8", "#F4F6F2", "#FFFFFF").
- "palette": Genau 5 harmonische Hex-Farben passend zu Projekt & Bildern (echte Akzent- und Materialfarben, nicht nur Grau).
- "badgeText": Kurzer, stilvoller 1-3-Wort-Titel für das runde Badge (z. B. "${projectTitle}").
- "badgeBg": Dunkler oder warmer Akzent-Hex für das runde Badge (z. B. "#262927", "#2F5241", "#5D4E3E").
Antworte ausschließlich als JSON.`;
            director = await requestGeminiJson(prompt, geminiKey, 1500, 0.35, extraParts);
          } catch (err) {
            console.warn('KI-Layout Fallback aktiv:', err);
          }
          showSyncStatus('', false);
        }

        const plan = buildEditorialGridPlan(visualItems, { ...(director || {}), prioritySwatches: swatchHexes }, projectTitle, fallbackPalette, keepFormatting, { heroId, layoutStyle, projectLead: home.lead || '', projectEyebrow: home.eyebrow || '', aspectWtoHMap });

        pushCanvasUndo(folderId);

        const cropsRes = (director && typeof director.crops === 'object' && director.crops) ? director.crops : {};
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
              const cr = cropsRes[it.id] || {};
              it.canvas.shape = p.shape;
              it.canvas.frameColor = p.frameColor || '';
              it.canvas.frameWidth = p.frameWidth || 6;
              it.canvas.shadow = !!p.shadow;
              if (cr.focusX !== undefined) it.canvas.cropX = Math.max(0, Math.min(100, Math.round(Number(cr.focusX) || 50)));
              if (cr.focusY !== undefined) it.canvas.cropY = Math.max(0, Math.min(100, Math.round(Number(cr.focusY) || 50)));
              const imgAr = aspectWtoHMap.get(it.id) || 1;
              const tileAr = p.w / Math.max(1, p.h);
              const mismatch = Math.max(imgAr / tileAr, tileAr / imgAr);
              const maxMismatch = cr.canCrop === false ? 1.85 : 2.1;
              it.canvas.fitMode = (p.shape !== 'circle' && mismatch > maxMismatch) ? 'contain' : 'cover';
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
        const allEndBoxes = [...visualItems.map((it) => it.canvas), ...(content.board.canvasElements || [])];
        const autoW = Math.max(...allEndBoxes.map((b) => (b.x || 0) + (b.w || 200))) + 40;
        const autoH = Math.max(...allEndBoxes.map((b) => (b.y || 0) + (b.h || 200))) + 40;
        content.board.canvasSettings.boardWidth = autoW;
        content.board.canvasSettings.boardHeight = autoH;

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

      function openPlaceholderPickerModal(placeholderEl, folderId, container, statsEl) {
        const content = state.folderContents[folderId];
        if (!content || !placeholderEl) return;
        const grid = document.getElementById('placeholderPickGrid');
        const invBtn = document.getElementById('phPickFromInvBtn');
        const upBtn = document.getElementById('phUploadNewBtn');
        if (!grid) return;

        function applyBoxToItem(item) {
          pushCanvasUndo(folderId);
          item.canvasHidden = false;
          item.canvas = {
            ...(item.canvas || {}),
            x: placeholderEl.x,
            y: placeholderEl.y,
            w: placeholderEl.w,
            h: placeholderEl.h,
            z: placeholderEl.z || 1,
            shape: placeholderEl.shape || 'rect',
            shapeAngle: placeholderEl.shapeAngle || 0,
            borderRadius: placeholderEl.borderRadius ?? 14,
            frameColor: placeholderEl.frameColor || '',
            frameWidth: placeholderEl.frameWidth || 6,
            shadow: placeholderEl.shadow !== false,
            overlayText: placeholderEl.overlayText ? { ...placeholderEl.overlayText } : undefined
          };
          content.board.canvasElements = (content.board.canvasElements || []).filter((e) => e.id !== placeholderEl.id);
          state.selectedCanvasIds = new Set([item.id]);
          scheduleBoardSave(folderId);
          closeModal('placeholderPickModal');
          renderCanvasView(container, statsEl, folderId);
        }

        function renderProjectImages() {
          const items = (content.board.items || []).filter((it) => {
            const res = resolveBoardItem(it, folderId);
            return res.kind === 'image' && res.imageSrc;
          });
          if (items.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1; padding:18px; text-align:center; color:var(--text-secondary);">Noch keine Bilder in diesem Projektordner. Wähle „Aus Inventory wählen“ oder lade ein neues Bild hoch.</div>';
            return;
          }
          grid.innerHTML = items.map((it) => {
            const res = resolveBoardItem(it, folderId);
            return `
              <button type="button" class="btn" data-ph-item-id="${escapeHtml(it.id)}" style="display:flex; flex-direction:column; align-items:stretch; padding:6px; gap:6px; text-align:left;">
                <img src="${escapeHtml(res.imageSrc)}" alt="" style="width:100%; height:96px; object-fit:cover; border-radius:6px;" />
                <span style="font-size:0.76rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(res.title || 'Bild')}</span>
              </button>
            `;
          }).join('');
          grid.querySelectorAll('[data-ph-item-id]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const id = btn.getAttribute('data-ph-item-id');
              const item = (content.board.items || []).find((x) => x.id === id);
              if (item) applyBoxToItem(item);
            });
          });
        }

        function renderInventoryImages() {
          const invItems = (state.inventory || []).filter((inv) => inv.imageSrc || inv.driveFileId);
          if (invItems.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1; padding:18px; text-align:center; color:var(--text-secondary);">Keine Bilder im Inventory vorhanden.</div>';
            return;
          }
          grid.innerHTML = invItems.map((inv) => {
            const src = inv.imageSrc || (inv.driveFileId ? getDriveImageUrl(inv.driveFileId) : '');
            return `
              <button type="button" class="btn" data-ph-inv-id="${escapeHtml(inv.id)}" style="display:flex; flex-direction:column; align-items:stretch; padding:6px; gap:6px; text-align:left;">
                <img src="${escapeHtml(src)}" alt="" style="width:100%; height:96px; object-fit:cover; border-radius:6px;" />
                <span style="font-size:0.76rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(inv.title || 'Inventory-Bild')}</span>
              </button>
            `;
          }).join('');
          grid.querySelectorAll('[data-ph-inv-id]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const invId = btn.getAttribute('data-ph-inv-id');
              const existing = (content.board.items || []).find((x) => x.kind === 'inventoryRef' && x.inventoryId === invId);
              if (existing) {
                applyBoxToItem(existing);
                return;
              }
              const newItem = {
                id: uid('b'),
                kind: 'inventoryRef',
                inventoryId: invId,
                notes: '',
                canvas: {}
              };
              content.board.items.push(newItem);
              applyBoxToItem(newItem);
            });
          });
        }

        if (invBtn) {
          let showingInv = false;
          invBtn.textContent = '📦 Aus Inventory wählen';
          invBtn.onclick = () => {
            showingInv = !showingInv;
            invBtn.textContent = showingInv ? '🖼️ Projekt-Bilder zeigen' : '📦 Aus Inventory wählen';
            if (showingInv) renderInventoryImages();
            else renderProjectImages();
          };
        }
        if (upBtn) {
          upBtn.onclick = () => {
            closeModal('placeholderPickModal');
            const up = document.getElementById('fileUploadInput');
            if (up) up.click();
          };
        }

        renderProjectImages();
        openModal('placeholderPickModal');
      }

      function openTemplatesModal(folderId, container, statsEl) {
        const content = state.folderContents[folderId];
        if (!content) return;
        const listEl = document.getElementById('templatesList');
        const nameInp = document.getElementById('newTemplateNameInput');
        const saveBtn = document.getElementById('saveCurrentAsTemplateBtn');
        if (!listEl || !nameInp || !saveBtn) return;

        function renderList() {
          const tpls = Array.isArray(state.boardTemplates) ? state.boardTemplates : [];
          if (tpls.length === 0) {
            listEl.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text-secondary); font-size:0.86rem;">Noch keine Templates gespeichert. Gib oben einen Namen ein und speichere dein aktuelles Board!</div>';
            return;
          }
          listEl.innerHTML = tpls.map((tpl) => {
            const slotCount = Array.isArray(tpl.slots) ? tpl.slots.length : 0;
            const elCount = Array.isArray(tpl.elements) ? tpl.elements.length : 0;
            const sizeLabel = tpl.boardWidth > 0 && tpl.boardHeight > 0 ? `${tpl.boardWidth}×${tpl.boardHeight}px` : 'Frei';
            return `
              <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border:1px solid var(--border-color); border-radius:var(--radius-md); background:var(--card-subtle);">
                <div style="min-width:0;">
                  <div style="font-weight:600; font-size:0.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(tpl.name || 'Template')}</div>
                  <div style="font-size:0.76rem; color:var(--text-secondary);">${sizeLabel} · ${slotCount} Bild-Slots · ${elCount} Elemente</div>
                </div>
                <div style="display:flex; gap:6px; flex-shrink:0;">
                  <button type="button" class="btn btn-oak btn-sm" data-tpl-apply="${escapeHtml(tpl.id)}">Anwenden</button>
                  <button type="button" class="btn btn-danger btn-sm" data-tpl-del="${escapeHtml(tpl.id)}" title="Template löschen">🗑️</button>
                </div>
              </div>
            `;
          }).join('');

          listEl.querySelectorAll('[data-tpl-apply]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const id = btn.getAttribute('data-tpl-apply');
              const tpl = (state.boardTemplates || []).find((t) => t.id === id);
              if (!tpl) return;
              const autoFill = !!document.getElementById('tplAutoFillCb')?.checked;
              pushCanvasUndo(folderId);

              content.board.canvasSettings = {
                ...(content.board.canvasSettings || {}),
                bgColor: tpl.bgColor || '',
                bgMode: tpl.bgMode || 'default',
                fitMode: tpl.fitMode || 'cover',
                boardWidth: Number(tpl.boardWidth) || 0,
                boardHeight: Number(tpl.boardHeight) || 0
              };

              const newElements = (tpl.elements || []).map((el) => ({ ...JSON.parse(JSON.stringify(el)), id: uid('cel') }));
              const projectImages = (content.board.items || []).filter((it) => {
                const res = resolveBoardItem(it, folderId);
                return res.kind === 'image';
              });
              projectImages.forEach((it) => { it.canvasHidden = true; });

              const slots = Array.isArray(tpl.slots) ? tpl.slots : [];
              slots.forEach((slot, idx) => {
                if (autoFill && idx < projectImages.length) {
                  const target = projectImages[idx];
                  target.canvasHidden = false;
                  target.canvas = { ...JSON.parse(JSON.stringify(slot)) };
                } else {
                  newElements.push({
                    ...JSON.parse(JSON.stringify(slot)),
                    id: uid('cel'),
                    type: 'placeholder'
                  });
                }
              });

              content.board.canvasElements = newElements;
              state.selectedCanvasIds.clear();
              scheduleBoardSave(folderId);
              closeModal('templatesModal');
              renderCanvasView(container, statsEl, folderId);
            });
          });

          listEl.querySelectorAll('[data-tpl-del]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const id = btn.getAttribute('data-tpl-del');
              const ok = await uiConfirm('Dieses Template wirklich löschen?', 'Template löschen');
              if (!ok) return;
              state.boardTemplates = (state.boardTemplates || []).filter((t) => t.id !== id);
              await saveBoardTemplates();
              renderList();
            });
          });
        }

        saveBtn.onclick = async () => {
          const name = nameInp.value.trim();
          if (!name) {
            uiAlert('Bitte gib einen Namen für das Template ein.');
            return;
          }
          const cs = content.board.canvasSettings || {};
          const vis = (content.board.items || []).filter((it) => !it.canvasHidden && resolveBoardItem(it, folderId).kind === 'image');
          const els = content.board.canvasElements || [];

          const slots = [
            ...vis.map((it) => JSON.parse(JSON.stringify(it.canvas || {}))),
            ...els.filter((e) => e.type === 'placeholder').map((e) => {
              const copy = JSON.parse(JSON.stringify(e));
              delete copy.id;
              delete copy.type;
              return copy;
            })
          ];
          const elements = els.filter((e) => e.type !== 'placeholder').map((e) => {
            const copy = JSON.parse(JSON.stringify(e));
            delete copy.id;
            return copy;
          });

          if (!Array.isArray(state.boardTemplates)) state.boardTemplates = [];
          state.boardTemplates.unshift({
            id: uid('tpl'),
            name,
            createdAt: new Date().toISOString(),
            bgColor: cs.bgColor || '',
            bgMode: cs.bgMode || 'default',
            fitMode: cs.fitMode || 'cover',
            boardWidth: Number(cs.boardWidth) || 0,
            boardHeight: Number(cs.boardHeight) || 0,
            slots,
            elements
          });
          nameInp.value = '';
          await saveBoardTemplates();
          renderList();
        };

        renderList();
        openModal('templatesModal');
      }
