'use strict';

      /* ========================================================================
         17. PHASE 4: AUTOMATISCHE FARB- & KI-BILDSUCHE + GEMINI-PDF-EXPORT
         ======================================================================== */
      function rgbToGermanColorName(r, g, b) {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2 / 255;
        const d = max - min;
        if (d < 22) {
          if (l > 0.85) return 'weiß';
          if (l > 0.65) return 'creme';
          if (l > 0.35) return 'grau';
          return 'schwarz';
        }
        let h = 0;
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = Math.round(h * 60);
        if (h < 0) h += 360;

        if (h < 18 || h >= 340) return l < 0.35 ? 'bordeaux' : 'rot';
        if (h < 42) return l > 0.72 ? 'beige' : (l < 0.4 ? 'braun' : 'holz');
        if (h < 62) return l > 0.75 ? 'creme' : 'gold';
        if (h < 155) return l > 0.6 ? 'salbei' : 'tannengrün';
        if (h < 200) return 'türkis';
        if (h < 255) return 'blau';
        if (h < 310) return 'lila';
        return 'rosa';
      }

      function analyzeColorsFromUrl(url) {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            try {
              const c = document.createElement('canvas');
              c.width = 32;
              c.height = 32;
              const ctx = c.getContext('2d', { willReadFrequently: true });
              ctx.drawImage(img, 0, 0, 32, 32);
              const data = ctx.getImageData(0, 0, 32, 32).data;
              const buckets = new Map();
              const namesSet = new Set();
              for (let i = 0; i < data.length; i += 16) {
                if (data[i + 3] < 128) continue;
                const r = data[i], g = data[i + 1], b = data[i + 2];
                const rk = Math.min(255, Math.round(r / 32) * 32);
                const gk = Math.min(255, Math.round(g / 32) * 32);
                const bk = Math.min(255, Math.round(b / 32) * 32);
                const key = `${rk},${gk},${bk}`;
                buckets.set(key, (buckets.get(key) || 0) + 1);
                namesSet.add(rgbToGermanColorName(r, g, b));
              }
              const colors = Array.from(buckets.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([rgb]) => '#' + rgb.split(',').map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase());
              resolve({ colors, colorNames: Array.from(namesSet) });
            } catch (e) {
              resolve({ colors: [], colorNames: [] });
            }
          };
          img.onerror = () => resolve({ colors: [], colorNames: [] });
          img.src = url;
        });
      }

      const CLIP_LABELS = [
        { en: 'christmas ornament bauble', de: 'Christbaumkugel' },
        { en: 'christmas tree', de: 'Christbaum' },
        { en: 'christmas wreath', de: 'Kranz' },
        { en: 'decorative garland', de: 'Girlande' },
        { en: 'string fairy lights', de: 'Lichterkette' },
        { en: 'wax candle', de: 'Kerze' },
        { en: 'candlestick holder', de: 'Kerzenhalter' },
        { en: 'lantern', de: 'Laterne' },
        { en: 'ceramic or glass vase', de: 'Vase' },
        { en: 'decorative figurine', de: 'Deko-Figur' },
        { en: 'lamp or pendant light', de: 'Lampe' },
        { en: 'dining table setting', de: 'Esstisch' },
        { en: 'wooden table', de: 'Tisch' },
        { en: 'chair or armchair', de: 'Stuhl' },
        { en: 'sofa or couch', de: 'Sofa' },
        { en: 'throw pillow cushion', de: 'Kissen' },
        { en: 'blanket or plaid', de: 'Decke' },
        { en: 'tablecloth or table runner', de: 'Tischdecke' },
        { en: 'linen napkin', de: 'Serviette' },
        { en: 'plates and tableware', de: 'Geschirr' },
        { en: 'wine glass or glassware', de: 'Gläser' },
        { en: 'cup or mug', de: 'Tasse' },
        { en: 'flowers or bouquet', de: 'Blumen' },
        { en: 'houseplant or greenery', de: 'Pflanze' },
        { en: 'eucalyptus or pine branch', de: 'Zweige' },
        { en: 'pinecone', de: 'Tannenzapfen' },
        { en: 'mirror', de: 'Spiegel' },
        { en: 'wooden tray or board', de: 'Holztablett' },
        { en: 'gift box with ribbon', de: 'Geschenk' },
        { en: 'carpet or rug', de: 'Teppich' }
      ];

      let clipWorker = null;
      function getClipWorker() {
        if (clipWorker) return clipWorker;
        const workerCode = `
          let classifier = null;
          self.onmessage = async (e) => {
            const { id, imageUrl, labels } = e.data;
            try {
              if (!classifier) {
                self.postMessage({ type: 'status', text: 'Lade CLIP-Modell (~100 MB, nur einmalig)…' });
                const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
                classifier = await pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32');
              }
              const res = await classifier(imageUrl, labels, { hypothesis_template: 'a photo of a {}' });
              self.postMessage({ type: 'result', id, res });
            } catch (err) {
              self.postMessage({ type: 'error', id, error: err.message || String(err) });
            }
          };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        clipWorker = new Worker(URL.createObjectURL(blob), { type: 'module' });
        return clipWorker;
      }

      let cachedGeminiModel = null;

      async function resolveGeminiModel(apiKey) {
        if (cachedGeminiModel) return cachedGeminiModel;
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
          if (res.ok) {
            const data = await res.json();
            const candidates = (data.models || []).filter((m) =>
              (m.supportedGenerationMethods || []).includes('generateContent') &&
              /flash|argon/i.test(m.name) &&
              !/2\.0|2\.5|1\.5|tts|audio|live|thinking/i.test(m.name)
            );
            const preferred =
              candidates.find((m) => /gemini-3\.5-flash-lite/i.test(m.name)) ||
              candidates.find((m) => /gemini-3\.8-flash/i.test(m.name)) ||
              candidates.find((m) => /flash/i.test(m.name)) ||
              candidates[0];
            if (preferred) {
              cachedGeminiModel = preferred.name.replace(/^models\//, '');
              return cachedGeminiModel;
            }
          }
        } catch (e) { /* Fallback unten */ }
        cachedGeminiModel = 'gemini-3.5-flash-lite';
        return cachedGeminiModel;
      }

      async function analyzeImageWithGemini(imageSrc, apiKey) {
        const base64 = await new Promise((resolve, reject) => {
          const im = new Image();
          im.onload = () => {
            const c = document.createElement('canvas');
            const scale = Math.min(1, 800 / im.width);
            c.width = Math.round(im.width * scale);
            c.height = Math.round(im.height * scale);
            c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
            resolve(c.toDataURL('image/jpeg', 0.8).split(',')[1]);
          };
          im.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
          im.src = imageSrc;
        });

        const modelName = await resolveGeminiModel(apiKey);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const allowedTags = state.globalTags || [];
        const tagInstruction = allowedTags.length > 0
          ? `Wähle für "tags" AUSSCHLIESSLICH passende Begriffe aus dieser festen Liste (erfinde KEINE neuen Tags, max. 4): ${JSON.stringify(allowedTags)}.`
          : 'Lasse "tags" als leeres Array [].';

        const body = {
          contents: [{
            parts: [
              {
                text: `Analysiere dieses Deko-/Einrichtungs-/Event-Bild für ein Inventar. Schreibe strikt sachlich, knapp und faktisch (KEINE Werbesprache, keine Wörter wie "edel", "besticht", "bezaubernd", "perfekt", "traumhaft"). ${tagInstruction} Antworte als JSON: {"title":"Sachlicher Objektname (max. 6 Wörter, z.B. Dunkelgrüne Christbaumkugeln matt & glänzend)","description":"Reine Faktenbeschreibung für die Suche: Objektart, Farbe, Material, Oberfläche, Form, Anzahl/Set (1-2 kurze Sätze)","tags":[]}.`
              },
              { inline_data: { mime_type: 'image/jpeg', data: base64 } }
            ]
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 512,
            temperature: 0.1
          }
        };

        for (let attempt = 0; attempt < 3; attempt++) {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          if (res.status === 429 || res.status === 503) {
            await new Promise((r) => setTimeout(r, 3500 * (attempt + 1)));
            continue;
          }
          if (!res.ok) {
            const errTxt = await res.text();
            throw new Error(`Gemini API (${res.status}): ${errTxt.slice(0, 120)}`);
          }
          const json = await res.json();
          const rawText = (json.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
          const match = rawText.match(/\{[\s\S]*\}/);
          const cleaned = (match ? match[0] : rawText).replace(/[\u0000-\u001F]+/g, ' ');
          try {
            return JSON.parse(cleaned);
          } catch (parseErr) {
            if (attempt < 2) {
              await new Promise((r) => setTimeout(r, 1000));
              continue;
            }
            throw parseErr;
          }
        }
        throw new Error('Gemini API vorübergehend überlastet (429/503).');
      }

      async function requestGeminiJson(promptText, apiKey, maxTokens = 2048, temperature = 0.4) {
        const modelName = await resolveGeminiModel(apiKey);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const body = {
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: maxTokens,
            temperature
          }
        };
        for (let attempt = 0; attempt < 3; attempt++) {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          if (res.status === 429 || res.status === 503) {
            await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
            continue;
          }
          if (!res.ok) {
            const errTxt = await res.text();
            throw new Error(`Gemini API (${res.status}): ${errTxt.slice(0, 120)}`);
          }
          const json = await res.json();
          const rawText = (json.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
          const match = rawText.match(/\{[\s\S]*\}/);
          const cleaned = (match ? match[0] : rawText).replace(/[\u0000-\u001F]+/g, ' ');
          try {
            return JSON.parse(cleaned);
          } catch (parseErr) {
            if (attempt < 2) {
              await new Promise((r) => setTimeout(r, 900));
              continue;
            }
            throw parseErr;
          }
        }
        throw new Error('Gemini API vorübergehend überlastet (429/503).');
      }

      function applyGeminiResultToItem(item, gRes, isNewUpload = false) {
        if (!gRes) return;
        if (!item.ai) item.ai = { colors: [], colorNames: [], labels: [] };
        item.ai.description = gRes.description || '';

        // Tags nur setzen, wenn die Karte noch KEINE Tags hat – und strikt aus state.globalTags filtern
        if (!Array.isArray(item.tags) || item.tags.length === 0) {
          const allowedMap = new Map(state.globalTags.map((t) => [t.toLowerCase(), t]));
          const picked = (Array.isArray(gRes.tags) ? gRes.tags : [])
            .map((t) => allowedMap.get(String(t).trim().toLowerCase()))
            .filter(Boolean);
          item.ai.labels = Array.from(new Set(picked));
          item.tags = [...item.ai.labels];
        }

        if (gRes.title) {
          item.title = gRes.title;
        }
        if (gRes.description && (isNewUpload || !item.note)) {
          item.note = gRes.description;
        }
      }

      async function runAiScanForFolder(folderId) {
        const content = state.folderContents[folderId];
        if (!content) return;
        const images = (content.board.items || []).map((it) => resolveBoardItem(it, folderId)).filter((it) => it && it.type === 'image');
        if (images.length === 0) {
          await uiAlert('Keine eigenen Bilder in diesem Ordner vorhanden.');
          return;
        }

        // Schritt 1: Sofortige Farbanalyse für alle Bilder
        showSyncStatus('Analysiere Farben der Bilder…', true);
        const touchedFolders = new Set();
        for (const item of images) {
          const target = item.targetItem || item;
          const targetFId = item.targetFolderId || folderId;
          if (!target.ai) target.ai = { colors: [], colorNames: [], labels: [] };
          if (!target.ai.colorNames || target.ai.colorNames.length === 0) {
            const src = item.localDataUrl || (item.driveFileId && state.mode === 'drive' ? await DriveAdapter.fetchBlobUrl(item.driveFileId) : '');
            if (src) {
              const res = await analyzeColorsFromUrl(src);
              target.ai.colors = res.colors;
              target.ai.colorNames = res.colorNames;
              item.ai = target.ai;
              touchedFolders.add(targetFId);
            }
          }
        }
        for (const fId of touchedFolders) scheduleBoardSave(fId);
        showSyncStatus('', false);

        const { geminiKey } = getSettings();
        if (geminiKey) {
          const rescanAll = await uiConfirm(
            'Klicke OK, um Bilder ohne Gemini-Beschreibung jetzt automatisch mit Gemini anzureichern (mit 2 Sek. Pause zwischen Bildern).',
            'Gemini KI-Anreicherung starten',
            'Anreichern'
          );
          if (!rescanAll) { renderMainView(); return; }

          const targets = images.filter((it) => !(it.targetItem || it).ai || !(it.targetItem || it).ai.description);
          const list = targets.length > 0 ? targets : images;
          for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const target = item.targetItem || item;
            const targetFId = item.targetFolderId || folderId;
            const src = item.localDataUrl || (item.driveFileId && state.mode === 'drive' ? await DriveAdapter.fetchBlobUrl(item.driveFileId) : '');
            if (!src) continue;
            showSyncStatus(`Gemini reichert Bild ${i + 1} von ${list.length} an…`, true);
            try {
              const gRes = await analyzeImageWithGemini(src, geminiKey);
              if (gRes) {
                applyGeminiResultToItem(target, gRes, false);
                scheduleBoardSave(targetFId);
              }
            } catch (err) {
              console.warn('Gemini Fehler:', err);
              await uiAlert('Gemini-Anreicherung abgebrochen: ' + err.message, 'Fehler');
              break;
            }
            if (i < list.length - 1) await new Promise((r) => setTimeout(r, 2000));
          }
          showSyncStatus('KI-Anreicherung abgeschlossen!', true);
          setTimeout(() => showSyncStatus('', false), 2200);
          renderMainView();
          return;
        }

        const useClip = await uiConfirm(
          'Farbbegriffe (z. B. „salbei“, „gold“, „beige“) wurden sofort ergänzt!\n\nMöchtest du zusätzlich die KI-Motiverkennung (CLIP) im Browser aktivieren?\n(Lädt einmalig ~100 MB im Hintergrund – auf Desktop/WLAN empfohlen.)',
          'KI-Motiverkennung (CLIP)',
          'Aktivieren'
        );
        if (!useClip) {
          renderMainView();
          return;
        }

        const worker = getClipWorker();
        const enLabels = CLIP_LABELS.map((l) => l.en);
        const enToDe = Object.fromEntries(CLIP_LABELS.map((l) => [l.en, l.de]));

        worker.onmessage = (ev) => {
          const msg = ev.data;
          if (msg.type === 'status') {
            showSyncStatus(msg.text, true);
          } else if (msg.type === 'result') {
            const item = images.find((x) => x.id === msg.id);
            if (item) {
              const target = item.targetItem || item;
              const targetFId = item.targetFolderId || folderId;
              if (!target.ai) target.ai = { colors: [], colorNames: [], labels: [] };
              const sorted = (msg.res || []).slice().sort((a, b) => b.score - a.score);
              const bestScore = sorted[0] ? sorted[0].score : 0;
              const picked = sorted
                .filter((r, idx) => (idx === 0 && r.score >= 0.16) || (r.score >= 0.22 && r.score >= bestScore * 0.65))
                .slice(0, 2)
                .map((r) => enToDe[r.label] || r.label);

              const prevAiLabels = new Set(target.ai.labels || []);
              const manualTags = (target.tags || []).filter((t) => !prevAiLabels.has(t));
              target.ai.labels = Array.from(new Set(picked));
              target.tags = Array.from(new Set([...manualTags, ...target.ai.labels]));
              scheduleBoardSave(targetFId);
            }
          } else if (msg.type === 'error') {
            console.warn('CLIP Worker Fehler:', msg.error);
          }
        };

        showSyncStatus('Erkenne Bildmotive im Web Worker…', true);
        for (const item of images) {
          const src = item.localDataUrl || (item.driveFileId && state.mode === 'drive' ? await DriveAdapter.fetchBlobUrl(item.driveFileId) : '');
          if (!src) continue;
          await new Promise((resolve) => {
            const origOnMsg = worker.onmessage;
            worker.onmessage = (ev) => {
              origOnMsg(ev);
              if (ev.data.type === 'result' || ev.data.type === 'error') resolve();
            };
            worker.postMessage({ id: item.id, imageUrl: src, labels: enLabels });
          });
        }
        showSyncStatus('KI-Motiverkennung abgeschlossen!', true);
        setTimeout(() => showSyncStatus('', false), 2200);
        renderMainView();
      }

      async function ensureJsPdfLoaded() {
        if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('jsPDF konnte nicht geladen werden.'));
          document.head.appendChild(s);
        });
        return window.jspdf.jsPDF;
      }

      async function exportFolderToGeminiPdf(folderId) {
        if (!folderId || !state.folderContents[folderId]) {
          await uiAlert('Bitte wähle zuerst einen Projektordner aus.');
          return;
        }
        const content = state.folderContents[folderId];
        const folder = state.folders.find((f) => f.id === folderId);
        const folderName = folder ? folder.name : 'Projekt';

        showSyncStatus('Erstelle Gemini-PDF-Kontaktbogen…', true);
        try {
          const JsPDF = await ensureJsPdfLoaded();
          const doc = new JsPDF({ unit: 'mm', format: 'a4' });
          const { todoEntries, planned, spent } = collectPlanningData(folderId, true);
          const limit = Number((content.board.budget && content.board.budget.limit) || 0);

          // Titel & Budget-Kopf (mit sauberem Umbruch)
          doc.setFontSize(16);
          const titleLines = doc.splitTextToSize(`Moodboard: ${folderName}`, 182);
          doc.text(titleLines, 14, 18);
          let y = 18 + titleLines.length * 6.5;

          doc.setFontSize(10);
          const budgetLine = `Budget: ${limit > 0 ? limit.toFixed(2) + ' EUR' : 'kein Limit'} | Verplant: ${planned.toFixed(2)} EUR | Ausgegeben: ${spent.toFixed(2)} EUR`;
          const budgetLines = doc.splitTextToSize(budgetLine, 182);
          doc.text(budgetLines, 14, y);
          y += budgetLines.length * 5 + 3;

          const openTodos = todoEntries.filter((t) => !t.ref.done);
          if (openTodos.length > 0) {
            doc.setFontSize(11);
            doc.text('Offene To-dos:', 14, y);
            y += 5;
            doc.setFontSize(9);
            for (const td of openTodos.slice(0, 12)) {
              const tdLines = doc.splitTextToSize(`- ${td.ref.text}`, 178);
              if (y + tdLines.length * 4.2 > 280) { doc.addPage(); y = 18; }
              doc.text(tdLines, 16, y);
              y += tdLines.length * 4.2 + 0.8;
            }
            y += 4;
          }

          // Nummerierte Bilder im 2-Spalten-Raster (unverzerrt + sauber umbrochen)
          const items = (content.board.items || []).map((it) => resolveBoardItem(it, folderId)).filter(Boolean);
          const maxBoxW = 84;
          const maxBoxH = 54;

          for (let i = 0; i < items.length; i += 2) {
            const pair = [items[i], items[i + 1]].filter(Boolean);
            const prepared = [];
            let maxTextH = 0;

            for (let cIdx = 0; cIdx < pair.length; cIdx++) {
              const item = pair[cIdx];
              const num = i + cIdx + 1;
              const src = item.localDataUrl || (item.driveFileId && state.mode === 'drive' ? await DriveAdapter.fetchBlobUrl(item.driveFileId) : '');
              let imgData = null;
              if (src) {
                try {
                  imgData = await new Promise((res, rej) => {
                    const im = new Image();
                    im.onload = () => {
                      const c = document.createElement('canvas');
                      const scale = Math.min(1, 600 / im.width);
                      c.width = Math.round(im.width * scale);
                      c.height = Math.round(im.height * scale);
                      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
                      res({ dataUrl: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height });
                    };
                    im.onerror = rej;
                    im.src = src;
                  });
                } catch (e) { imgData = null; }
              }

              const priceTxt = item.shopping && item.shopping.enabled ? ` (${Number(item.shopping.price || 0).toFixed(2)} EUR)` : '';
              doc.setFontSize(9.5);
              const tLines = doc.splitTextToSize(`#${num} ${item.title || 'Ohne Titel'}${priceTxt}`, maxBoxW).slice(0, 2);
              doc.setFontSize(8);
              const tagsTxt = (item.tags && item.tags.length > 0) ? `Tags: ${item.tags.join(', ')}` : '';
              const nLines = item.note ? doc.splitTextToSize(item.note, maxBoxW).slice(0, 4) : [];
              const tagLines = tagsTxt ? doc.splitTextToSize(tagsTxt, maxBoxW).slice(0, 2) : [];

              const textH = tLines.length * 4.2 + nLines.length * 3.6 + tagLines.length * 3.6 + 6;
              if (textH > maxTextH) maxTextH = textH;
              prepared.push({ imgData, tLines, nLines, tagLines });
            }

            const rowHeight = maxBoxH + 4 + maxTextH + 4;
            if (y + rowHeight > 285) {
              doc.addPage();
              y = 18;
            }

            for (let cIdx = 0; cIdx < prepared.length; cIdx++) {
              const p = prepared[cIdx];
              const x = cIdx === 0 ? 14 : 108;

              // Heller Rahmen um Bildbox
              doc.setDrawColor(225, 222, 216);
              doc.rect(x, y, maxBoxW, maxBoxH);

              if (p.imgData) {
                const ratio = Math.min(maxBoxW / p.imgData.w, maxBoxH / p.imgData.h);
                const drawW = p.imgData.w * ratio;
                const drawH = p.imgData.h * ratio;
                const drawX = x + (maxBoxW - drawW) / 2;
                const drawY = y + (maxBoxH - drawH) / 2;
                doc.addImage(p.imgData.dataUrl, 'JPEG', drawX, drawY, drawW, drawH);
              }

              let ty = y + maxBoxH + 5;
              doc.setFontSize(9.5);
              doc.setTextColor(44, 46, 45);
              doc.text(p.tLines, x, ty);
              ty += p.tLines.length * 4.2 + 1;

              if (p.nLines.length > 0) {
                doc.setFontSize(8);
                doc.setTextColor(100, 102, 100);
                doc.text(p.nLines, x, ty);
                ty += p.nLines.length * 3.6 + 1;
              }
              if (p.tagLines.length > 0) {
                doc.setFontSize(7.5);
                doc.setTextColor(140, 120, 90);
                doc.text(p.tagLines, x, ty);
              }
              doc.setTextColor(0, 0, 0);
            }

            y += rowHeight;
          }

          const pdfBlob = doc.output('blob');
          const safeName = folderName.replace(/[^a-zA-Z0-9_-]+/g, '-');
          const fileName = `Moodboard-Uebersicht-${safeName}.pdf`;

          if (state.mode === 'drive') {
            const existing = (content.driveFiles || []).find((f) => f.name === fileName);
            const saved = await DriveAdapter.uploadMultipart(folderId, fileName, 'application/pdf', pdfBlob, existing ? existing.id : null);
            if (!existing) content.driveFiles.unshift(saved);
            showSyncStatus(`PDF „${fileName}“ in Google Drive gespeichert – bereit für Gemini!`, true);
            setTimeout(() => showSyncStatus('', false), 3500);
            renderMainView();
          } else {
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
            showSyncStatus('PDF lokal heruntergeladen (Demo-Modus)', true);
            setTimeout(() => showSyncStatus('', false), 2500);
          }
        } catch (err) {
          await uiAlert('PDF-Export fehlgeschlagen: ' + err.message, 'Fehler');
          showSyncStatus('', false);
        }
      }

      document.getElementById('aiScanBtn').addEventListener('click', () => {
        if (!state.activeFolderId) { uiAlert('Bitte wähle zuerst einen Ordner aus.'); return; }
        runAiScanForFolder(state.activeFolderId);
      });

      document.getElementById('geminiPdfBtn').addEventListener('click', () => {
        exportFolderToGeminiPdf(state.activeFolderId);
      });

      async function addGlobalTagFromInput() {
        const inp = document.getElementById('newGlobalTagInput');
        const val = inp.value.trim().replace(/^#/, '');
        if (!val) return;
        if (!state.globalTags.some((t) => t.toLowerCase() === val.toLowerCase())) {
          state.globalTags.push(val);
          await saveGlobalTags();
          renderGlobalTagsManager();
          renderMainView();
        }
        inp.value = '';
      }

      document.getElementById('addGlobalTagBtn').addEventListener('click', addGlobalTagFromInput);
      document.getElementById('newGlobalTagInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addGlobalTagFromInput(); }
      });

      async function addGlobalLocationFromInput() {
        const inp = document.getElementById('newGlobalLocationInput');
        const val = inp.value.trim();
        if (!val) return;
        if (!state.globalLocations.some((l) => l.toLowerCase() === val.toLowerCase())) {
          state.globalLocations.push(val);
          await saveGlobalLocations();
          renderGlobalLocationsManager();
          renderMainView();
        }
        inp.value = '';
      }

      document.getElementById('addGlobalLocationBtn').addEventListener('click', addGlobalLocationFromInput);
      document.getElementById('newGlobalLocationInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addGlobalLocationFromInput(); }
      });
      document.getElementById('resetDefaultTagsBtn').addEventListener('click', async () => {
        if (!(await uiConfirm('Tag-Liste durch die aktuelle Standard-Liste ersetzen?', 'Standard-Tags laden', 'Ersetzen'))) return;
        state.globalTags = ['Basteln', 'Material', 'Deko', 'Inspiration', 'Weihnachten', 'Dekoobjekt', 'Verpackung', 'Möbel', 'Tischdeko', 'Trockenblume', 'Streudeko', 'Karte', 'Ostern', 'Christbaum', 'Vase', 'Kuchen', 'Rezept', 'Winter', 'Dekobasis', 'Kerzenhalter', 'Outdoor', 'Kerze', 'Plätzchen', 'Sommer', 'Frühling', 'Herbst', 'Pflanzen'];
        state.activeTagFilters.clear();
        await saveGlobalTags();
        renderGlobalTagsManager();
        renderMainView();
      });

      document.addEventListener('click', () => {
        if (state.tagDropdownOpen) {
          state.tagDropdownOpen = false;
          const pop = document.getElementById('tagFilterPopover');
          if (pop) pop.classList.add('hidden');
        }
        if (state.locationDropdownOpen) {
          state.locationDropdownOpen = false;
          const pop = document.getElementById('locationFilterPopover');
          if (pop) pop.classList.add('hidden');
        }
      });

      // Init
      const verEl = document.getElementById('appVersionBadge');
      if (verEl) verEl.textContent = APP_VERSION;
      applyTheme(localStorage.getItem(LS_KEYS.theme) || 'day');
      if (localStorage.getItem(LS_KEYS.demoMode) === '1') {
        startDemoMode();
      } else {
        updateAuthUI();
        renderSidebar();
        renderMainView();
      }
      window.addEventListener('load', () => { initAuthClient(); });