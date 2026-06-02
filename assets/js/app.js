/* ============================================================
   HEC · Premier cycle — Logique applicative
   Modèle : groupes question → sous-pièces cochables, cahier
   réordonnable par glisser-déposer, génération .docx côté client.
   ============================================================ */

(function () {
  'use strict';

  // ====== ÉTAT ======
  const state = {
    // Toutes les questions du catalogue (après filtrage)
    filteredQuestions: [],
    // Cahier en construction : tableau ordonné de pièces sélectionnées
    // chaque entrée : { kind: 'questionBody'|'reglette'|'document', questionId, pieceId, label }
    cahier: [],
    // Mode courant de prévisualisation ('cahier' | 'corrige')
    previewMode: 'cahier',
    // Terme de recherche courant (normalisé : minuscules, sans accents)
    searchTerm: '',
  };

  // ====== DOM ======
  const $ = (id) => document.getElementById(id);
  const el = {
    catalogList:      $('catalog-list'),
    catalogCount:     $('catalog-count'),
    cahierList:       $('cahier-list'),
    cahierCount:      $('cahier-count'),
    filterNiveau:     $('filter-niveau'),
    filterRealite:    $('filter-realite'),
    filterOp:         $('filter-operation'),
    resetFilters:     $('reset-filters'),
    searchInput:      $('search-input'),
    searchClear:      $('search-clear'),
    btnGenerate:        $('btn-generate'),
    btnGenerateCorrige: $('btn-generate-corrige'),
    btnPreview:         $('btn-preview'),
    btnPreviewCorrige:  $('btn-preview-corrige'),
    btnGenerateVariante: $('btn-generate-variante'),
    btnPreviewVariante:  $('btn-preview-variante'),
    btnGenerateCorrigeVariante: $('btn-generate-corrige-variante'),
    btnPreviewCorrigeVariante:  $('btn-preview-corrige-variante'),
    btnClear:           $('btn-clear-cahier'),
    btnShuffle:         $('btn-shuffle-cahier'),
    loading:            $('loading-overlay'),
    loadingMsg:         $('loading-message'),
    previewOverlay:     $('preview-overlay'),
    previewContainer:   $('preview-container'),
    modalClose:         $('modal-close'),
    modalDownload:      $('modal-download'),
    modalTitle:         $('modal-title'),
  };

  // ====== INIT ======
  function init() {
    // Par défaut, toutes les réalités sociales sont repliées dans le catalogue
    DATA.realites_sociales.forEach(r => collapsedRealites.add(r.id));
    populateFilters();
    attachEventListeners();
    applyFilters();
    initSortable();
    renderCahier();
  }

  function populateFilters() {
    // Affichage trié par niveau (Sec 1 d'abord) ; ordre stable pour réalités de même niveau.
    const realitesParNiveau = DATA.realites_sociales.slice().sort((a, b) => a.niveau - b.niveau);
    realitesParNiveau.forEach(r => {
      const o = document.createElement('option');
      o.value = r.id; o.textContent = r.titre;
      el.filterRealite.appendChild(o);
    });
    DATA.operations_intellectuelles.forEach(op => {
      const o = document.createElement('option');
      o.value = op; o.textContent = op;
      el.filterOp.appendChild(o);
    });
  }

  function attachEventListeners() {
    [el.filterNiveau, el.filterRealite, el.filterOp].forEach(s =>
      s.addEventListener('change', applyFilters)
    );
    el.resetFilters.addEventListener('click', () => {
      el.filterNiveau.value = '';
      el.filterRealite.value = '';
      el.filterOp.value = '';
      el.searchInput.value = '';
      applyFilters();
    });
    el.searchInput.addEventListener('input', applyFilters);
    el.searchClear.addEventListener('click', () => {
      el.searchInput.value = '';
      el.searchInput.focus();
      applyFilters();
    });
    el.btnClear.addEventListener('click', () => {
      state.cahier = [];
      renderCatalog();
      renderCahier();
    });
    el.btnShuffle.addEventListener('click', shuffleCahier);
    el.btnGenerate.addEventListener('click', () => generateDocx(true));
    el.btnGenerateCorrige.addEventListener('click', () => generateDocx(true, /*corrige*/ true));
    el.btnPreview.addEventListener('click', () => previewCahier(false));
    el.btnPreviewCorrige.addEventListener('click', () => previewCahier(true));
    el.btnGenerateVariante.addEventListener('click', () => generateDocx(true, false, /*variant*/ true));
    el.btnPreviewVariante.addEventListener('click', () => previewCahier(false, /*variant*/ true));
    el.btnGenerateCorrigeVariante.addEventListener('click', () => generateDocx(true, /*corrige*/ true, /*variant*/ true));
    el.btnPreviewCorrigeVariante.addEventListener('click', () => previewCahier(/*corrige*/ true, /*variant*/ true));
    el.modalClose.addEventListener('click', closePreview);
    el.modalDownload.addEventListener('click', () => {
      const mode = state.previewMode;
      const isCorrige = mode === 'corrige' || mode === 'variante-corrige';
      const isVariant = mode === 'variante' || mode === 'variante-corrige';
      closePreview();
      generateDocx(true, isCorrige, isVariant);
    });
    el.previewOverlay.addEventListener('click', (e) => {
      if (e.target === el.previewOverlay) closePreview();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.previewOverlay.hidden) closePreview();
    });
  }

  // ====== RECHERCHE PAR MOT-CLÉ ======

  // Normalise pour une comparaison insensible à la casse et aux accents.
  function normalizeText(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  // Texte interrogeable d'une question : énoncé + puces + titres/textes/sources des documents.
  function questionSearchText(q) {
    const parts = [q.questionBody.prompt || ''];
    if (q.questionBody.bullets) parts.push(q.questionBody.bullets.join(' '));
    if (q.questionBody.instructions) parts.push(String(q.questionBody.instructions));
    (q.documents || []).forEach(d => {
      if (!d) return;
      if (d.title) parts.push(d.title);
      if (d.text) parts.push(d.text);
      if (d.sources) parts.push(d.sources.join(' '));
    });
    return normalizeText(parts.join('  '));
  }

  // Le terme apparaît-il dans l'énoncé (ou les puces) plutôt que seulement dans un document ?
  function termInPrompt(q, term) {
    const t = normalizeText((q.questionBody.prompt || '') + ' ' + ((q.questionBody.bullets || []).join(' ')));
    return t.includes(term);
  }

  // Surligne (insensible aux accents) les occurrences du terme dans le texte original, en échappant le HTML.
  function highlightMatches(original, term) {
    if (!term) return escapeHtml(original);
    let norm = '';
    const map = []; // map[k] = index dans `original` du k-ième caractère normalisé
    for (let i = 0; i < original.length; i++) {
      const nf = normalizeText(original[i]);
      for (let j = 0; j < nf.length; j++) { norm += nf[j]; map.push(i); }
    }
    const ranges = [];
    let from = 0, idx;
    while ((idx = norm.indexOf(term, from)) !== -1) {
      ranges.push([map[idx], map[idx + term.length - 1] + 1]);
      from = idx + term.length;
    }
    if (!ranges.length) return escapeHtml(original);
    let out = '', cur = 0;
    ranges.forEach(([s, e]) => {
      out += escapeHtml(original.slice(cur, s));
      out += '<mark class="search-hit">' + escapeHtml(original.slice(s, e)) + '</mark>';
      cur = e;
    });
    out += escapeHtml(original.slice(cur));
    return out;
  }

  // ====== FILTRES ======
  function applyFilters() {
    const niv = el.filterNiveau.value;
    const rea = el.filterRealite.value;
    const op  = el.filterOp.value;

    // Terme de recherche courant (normalisé) + bascule de la croix d'effacement.
    const term = normalizeText((el.searchInput.value || '').trim());
    state.searchTerm = term;
    el.searchClear.hidden = !el.searchInput.value;

    state.filteredQuestions = DATA.questions.filter(q => {
      if (niv && String(q.niveau) !== niv) return false;
      if (rea && q.realite_sociale_id !== rea) return false;
      if (op  && q.operation !== op) return false;
      if (term && !questionSearchText(q).includes(term)) return false;
      return true;
    });

    // Une recherche déplie toutes les sections pour montrer les résultats.
    // Sinon : si l'utilisateur filtre sur une réalité précise, on la déplie ;
    // si aucun filtre, on remet toutes les réalités repliées par défaut.
    if (term) {
      collapsedRealites.clear();
    } else if (rea) {
      collapsedRealites.delete(rea);
    } else {
      DATA.realites_sociales.forEach(r => collapsedRealites.add(r.id));
    }

    el.catalogCount.textContent = `${state.filteredQuestions.length} question(s)`;
    renderCatalog();
  }

  // État global des groupes repliés (par realite_sociale_id)
  const collapsedRealites = new Set();

  // ====== RENDU DU CATALOGUE ======
  // (Pas de sous-pièces cochables : chaque question est une unité atomique)
  function renderCatalog() {
    el.catalogList.innerHTML = '';

    if (state.filteredQuestions.length === 0) {
      el.catalogList.innerHTML = '<div class="hint" style="text-align:center;padding:1.5rem;">Aucune question ne correspond aux filtres.</div>';
      return;
    }

    const realiteTitleById = {};
    const realiteIdxById = {};
    DATA.realites_sociales.forEach((r, i) => {
      realiteTitleById[r.id] = r.titre;
      realiteIdxById[r.id] = i;
    });

    // Grouper les questions filtrées par réalité sociale, triées par niveau
    // (Sec 1 d'abord, puis Sec 2). L'ordre d'insertion dans Map est conservé
    // à l'itération, donc on pré-initialise dans l'ordre voulu.
    const groupsMap = new Map();
    DATA.realites_sociales
      .slice()
      .sort((a, b) => a.niveau - b.niveau)
      .forEach(r => groupsMap.set(r.id, []));
    state.filteredQuestions.forEach(q => {
      if (!groupsMap.has(q.realite_sociale_id)) groupsMap.set(q.realite_sociale_id, []);
      groupsMap.get(q.realite_sociale_id).push(q);
    });

    // Construire les groupes pour chaque réalité présente
    groupsMap.forEach((questions, realiteId) => {
      if (questions.length === 0) return;
      const realiteIdx = realiteIdxById[realiteId] ?? 0;
      const realiteTitle = realiteTitleById[realiteId] || 'Sans réalité';

      const groupEl = document.createElement('div');
      groupEl.className = 'realite-group';
      if (collapsedRealites.has(realiteId)) groupEl.classList.add('collapsed');

      // En-tête de groupe (cliquable)
      const headerEl = document.createElement('div');
      headerEl.className = 'realite-group-header';
      headerEl.setAttribute('data-realite-idx', String(realiteIdx));
      const allUsed = questions.every(q => isQuestionUsed(q.id));
      const toggleAllLabel = allUsed ? 'Tout décocher' : 'Tout cocher';
      headerEl.innerHTML = `
        <span class="realite-toggle" aria-hidden="true">▼</span>
        <span class="realite-group-title">${escapeHtml(realiteTitle)}</span>
        <span class="realite-group-count">${questions.length} question${questions.length > 1 ? 's' : ''}</span>
        <button type="button" class="realite-group-toggle-all" aria-label="${toggleAllLabel} pour cette réalité">${toggleAllLabel}</button>
      `;
      headerEl.addEventListener('click', (e) => {
        if (e.target.closest('.realite-group-toggle-all')) return;
        if (collapsedRealites.has(realiteId)) collapsedRealites.delete(realiteId);
        else collapsedRealites.add(realiteId);
        renderCatalog();
      });
      // Bouton « Tout cocher / décocher » : ne déclenche pas le repli du groupe
      const toggleAllBtn = headerEl.querySelector('.realite-group-toggle-all');
      toggleAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (allUsed) {
          questions.forEach(q => removeAllPiecesForQuestion(q.id));
        } else {
          questions.forEach(q => { if (!isQuestionUsed(q.id)) addAllPiecesForQuestion(q); });
        }
        renderCatalog();
        renderCahier();
      });
      groupEl.appendChild(headerEl);

      const cardsContainer = document.createElement('div');
      cardsContainer.className = 'realite-group-cards';

      questions.forEach(q => {
        const card = document.createElement('div');
        card.className = 'question-card';
        card.setAttribute('data-realite-idx', String(realiteIdx));
        if (isQuestionUsed(q.id)) card.classList.add('has-selection');

        const checked = isQuestionUsed(q.id) ? 'checked' : '';
        const pointsTotal = computeQuestionPoints(q);
        const realite = realiteTitleById[q.realite_sociale_id] || '';

        const tagsHtml = `
          <div class="q-meta">
            <span class="tag tag-niveau">Secondaire ${q.niveau}</span>
            <span class="tag tag-operation">${escapeHtml(q.operation)}</span>
            <span class="tag tag-numero">#${q.numero}</span>
            ${realite ? `<span class="tag tag-realite" data-realite-idx="${realiteIdx}">${escapeHtml(realite)}</span>` : ''}
            ${pointsTotal > 0 ? `<span class="tag tag-points">${pointsTotal} pts</span>` : ''}
          </div>
        `;

        card.innerHTML = `
          <div class="question-header">
            <input type="checkbox" class="q-checkbox" data-q-id="${q.id}" ${checked} aria-label="Sélectionner cette question">
            <div class="q-content">
              ${tagsHtml}
              <p class="q-prompt">${state.searchTerm ? highlightMatches(q.questionBody.prompt, state.searchTerm) : escapeHtml(q.questionBody.prompt)}</p>
              ${state.searchTerm && !termInPrompt(q, state.searchTerm) ? '<span class="q-doc-hit">🔍 trouvé dans un document</span>' : ''}
            </div>
          </div>
        `;

        const header = card.querySelector('.question-header');
        const checkbox = card.querySelector('.q-checkbox');

        function toggleSelection() {
          if (isQuestionUsed(q.id)) {
            removeAllPiecesForQuestion(q.id);
          } else {
            addAllPiecesForQuestion(q);
          }
          renderCatalog();
          renderCahier();
        }

        header.addEventListener('click', (e) => {
          if (e.target === checkbox) return;
          toggleSelection();
        });
        checkbox.addEventListener('change', (e) => {
          e.stopPropagation();
          toggleSelection();
        });

        cardsContainer.appendChild(card);
      });

      groupEl.appendChild(cardsContainer);
      el.catalogList.appendChild(groupEl);
    });
  }

  // Total de points pour une question (somme des maxPoints de ses réglettes)
  function computeQuestionPoints(q) {
    return (q.reglettes || []).reduce((sum, r) => sum + (r.maxPoints || 0), 0);
  }

  // Total de points du cahier (somme des réglettes effectivement ajoutées)
  function computeCahierPoints() {
    let total = 0;
    state.cahier.forEach(p => {
      if (p.kind !== 'reglette') return;
      const q = DATA.questions.find(x => x.id === p.questionId);
      if (!q) return;
      const r = q.reglettes.find(x => x.id === p.pieceId);
      if (r && r.maxPoints) total += r.maxPoints;
    });
    return total;
  }

  // ====== GESTION CAHIER ======
  function pieceKey(qId, kind, pieceId) {
    return `${qId}::${kind}::${pieceId || ''}`;
  }

  function isQuestionUsed(qId) {
    return state.cahier.some(p => p.questionId === qId);
  }

  function isQuestionFullySelected(qId) {
    const q = DATA.questions.find(x => x.id === qId);
    if (!q) return false;
    const required = 1 + q.reglettes.filter(Boolean).length + q.documents.filter(Boolean).length;
    const have = state.cahier.filter(p => p.questionId === qId).length;
    return have === required;
  }

  function addAllPiecesForQuestion(question) {
    // Add questionBody, then each réglette, then each document — only if not already in cahier
    addPiece(question, 'questionBody', null);
    question.reglettes.forEach(r => { if (r) addPiece(question, 'reglette', r.id); });
    question.documents.forEach(d => { if (d) addPiece(question, 'document', d.id); });
    sortCahier();
  }

  function addPiece(question, kind, pieceId) {
    const key = pieceKey(question.id, kind, pieceId);
    if (state.cahier.some(p => pieceKey(p.questionId, p.kind, p.pieceId) === key)) return;
    const entry = {
      questionId: question.id,
      kind,
      pieceId,
      label: makePieceLabel(question, kind, pieceId)
    };
    // Insérer après la dernière pièce de la même question (contiguïté)
    let lastIdx = -1;
    for (let i = state.cahier.length - 1; i >= 0; i--) {
      if (state.cahier[i].questionId === question.id) { lastIdx = i; break; }
    }
    if (lastIdx === -1) state.cahier.push(entry);
    else state.cahier.splice(lastIdx + 1, 0, entry);
    sortCahier();
  }

  // Trie les pièces de chaque groupe-question dans l'ordre canonique
  // (questionBody → réglettes → documents, selon l'ordre des données)
  // SANS modifier l'ordre des groupes-questions entre eux (préservé par le drag-and-drop)
  function sortCahier() {
    const groups = new Map();
    const groupOrder = [];
    state.cahier.forEach(p => {
      if (!groups.has(p.questionId)) { groups.set(p.questionId, []); groupOrder.push(p.questionId); }
      groups.get(p.questionId).push(p);
    });
    groups.forEach((pieces, qId) => {
      const q = DATA.questions.find(x => x.id === qId);
      if (!q) return;
      const orderMap = {};
      orderMap['questionBody::'] = 0;
      q.reglettes.forEach((r, i) => { if (r) orderMap[`reglette::${r.id}`] = 100 + i; });
      q.documents.forEach((d, i) => { if (d) orderMap[`document::${d.id}`] = 200 + i; });
      pieces.sort((a, b) => {
        const aKey = `${a.kind}::${a.pieceId || ''}`;
        const bKey = `${b.kind}::${b.pieceId || ''}`;
        return (orderMap[aKey] ?? 999) - (orderMap[bKey] ?? 999);
      });
    });
    state.cahier = groupOrder.flatMap(qId => groups.get(qId));
  }

  // Place les questions dans un ordre aléatoire (mélange les groupes-questions,
  // sans toucher à l'ordre interne des pièces ; le glisser-déposer reste possible ensuite).
  function shuffleCahier() {
    const groups = new Map();
    const order = [];
    state.cahier.forEach(p => {
      if (!groups.has(p.questionId)) { groups.set(p.questionId, []); order.push(p.questionId); }
      groups.get(p.questionId).push(p);
    });
    if (order.length < 2) return;
    const original = order.join('|');
    let tries = 0;
    do {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    } while (order.join('|') === original && order.length > 1 && ++tries < 8);
    state.cahier = order.flatMap(qId => groups.get(qId));
    renderCahier();
  }

  function makePieceLabel(q, kind, pieceId) {
    const prefix = `[${q.operation} #${q.numero}] `;
    if (kind === 'questionBody') return `${prefix}Énoncé + espace de réponse`;
    if (kind === 'reglette') {
      const r = q.reglettes.find(x => x.id === pieceId);
      return `${prefix}${r ? r.label : 'Réglette'}`;
    }
    if (kind === 'document') {
      const d = q.documents.find(x => x.id === pieceId);
      return `${prefix}${d ? d.label : 'Document'}`;
    }
    return prefix;
  }

  function removePiece(qId, kind, pieceId) {
    const key = pieceKey(qId, kind, pieceId);
    state.cahier = state.cahier.filter(p => pieceKey(p.questionId, p.kind, p.pieceId) !== key);
  }

  function removeAllPiecesForQuestion(qId) {
    state.cahier = state.cahier.filter(p => p.questionId !== qId);
  }

  // ====== RENDU CAHIER (par groupe-question) ======
  function renderCahier() {
    el.cahierList.innerHTML = '';
    el.cahierList.classList.toggle('empty', state.cahier.length === 0);

    // Grouper les pièces consécutives par questionId (l'invariant garanti par sortCahier)
    const groups = [];
    let current = null;
    state.cahier.forEach(p => {
      if (!current || current.questionId !== p.questionId) {
        current = { questionId: p.questionId, pieces: [] };
        groups.push(current);
      }
      current.pieces.push(p);
    });

    const realiteTitleById = {};
    DATA.realites_sociales.forEach(r => realiteTitleById[r.id] = r.titre);

    groups.forEach(g => {
      const q = DATA.questions.find(x => x.id === g.questionId);
      if (!q) return;

      const card = document.createElement('div');
      card.className = 'cahier-group';
      card.dataset.qid = g.questionId;

      const header = document.createElement('header');
      header.className = 'cahier-group-header';
      header.innerHTML = `
        <span class="cahier-handle" aria-hidden="true">⋮⋮</span>
        <div class="cahier-group-meta">
          <span class="cahier-type t-question">#${q.numero}</span>
          <span class="cahier-group-title" title="${escapeHtml(q.operation)}">${escapeHtml(q.operation)}</span>
        </div>
        <button class="cahier-group-remove" type="button" aria-label="Retirer la question">×</button>
      `;
      header.querySelector('.cahier-group-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        removeAllPiecesForQuestion(g.questionId);
        renderCatalog();
        renderCahier();
      });
      card.appendChild(header);

      el.cahierList.appendChild(card);
    });

    el.cahierCount.innerHTML = `
      <span>${groups.length} question${groups.length > 1 ? 's' : ''}</span>
      <span style="margin: 0 0.4rem;">·</span>
      <span class="points-total">${computeCahierPoints()} pts</span>
    `;
    el.btnGenerate.disabled = state.cahier.length === 0;
    el.btnGenerateCorrige.disabled = state.cahier.length === 0;
    el.btnClear.disabled    = state.cahier.length === 0;
    el.btnShuffle.disabled  = groups.length < 2;
    el.btnPreview.disabled  = state.cahier.length === 0;
    el.btnPreviewCorrige.disabled = state.cahier.length === 0;
    el.btnGenerateVariante.disabled = state.cahier.length === 0;
    el.btnPreviewVariante.disabled  = state.cahier.length === 0;
    el.btnGenerateCorrigeVariante.disabled = state.cahier.length === 0;
    el.btnPreviewCorrigeVariante.disabled  = state.cahier.length === 0;
  }

  // ====== DRAG-AND-DROP (au niveau des groupes-questions) ======
  function initSortable() {
    Sortable.create(el.cahierList, {
      animation: 150,
      handle: '.cahier-group-header',
      draggable: '.cahier-group',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: () => {
        // Reconstruire state.cahier en fonction de l'ordre du DOM (par groupe-question)
        const newCahier = [];
        el.cahierList.querySelectorAll('.cahier-group').forEach(card => {
          const qid = card.dataset.qid;
          state.cahier.filter(p => p.questionId === qid).forEach(p => newCahier.push(p));
        });
        state.cahier = newCahier;
        renderCahier();
      }
    });
  }

  // ====== GÉNÉRATION DU .DOCX ======
  // Construit le document docx-js + retourne le Blob.
  async function buildDocxBlob() {
    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
      AlignmentType, BorderStyle, WidthType, ShadingType,
      VerticalAlign, HeadingLevel, LevelFormat, PageBreak, PageOrientation
    } = docx;

    const imageCache = await preloadImages();
    const builders = makeBuilders(docx, imageCache);

    // ---- Page couverture (toujours en premier) ----
    const coverElements = buildCoverPage(docx);

    // ---- Grouper les pièces du cahier par question (consécutivement) ----
    const groups = [];
    let cur = null;
    state.cahier.forEach(p => {
      if (!cur || cur.questionId !== p.questionId) {
        cur = { questionId: p.questionId, pieces: [] };
        groups.push(cur);
      }
      cur.pieces.push(p);
    });

    const NO_B = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const WRAPPER_NO_BORDERS = { top: NO_B, bottom: NO_B, left: NO_B, right: NO_B };

    const bodyChildren = [];
    bodyChildren.push(...coverElements);
    // Saut de page après la couverture
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));

    groups.forEach((g, idx) => {
      const q = DATA.questions.find(x => x.id === g.questionId);
      if (!q) return;

      // Numéro séquentiel : 1, 2, 3… dans l'ordre du cahier (et non l'ordre de l'opération)
      const seqNumero = idx + 1;

      // Saut de page avant chaque question (sauf la première) pour démarrer
      // chaque question sur une page neuve — assure une vraie pagination visible.
      if (idx > 0) {
        bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));
      }

      // Pièces "noyau" : énoncé + réglette → enveloppe non-coupable
      const corePieces = g.pieces.filter(p => p.kind === 'questionBody' || p.kind === 'reglette');
      if (corePieces.length > 0) {
        const innerChildren = [];
        corePieces.forEach(p => {
          if (p.kind === 'questionBody') {
            innerChildren.push(...builders.buildQuestionBody(q, seqNumero));
          } else if (p.kind === 'reglette') {
            const r = q.reglettes.find(x => x.id === p.pieceId);
            if (r) {
              innerChildren.push(new Paragraph({ children: [new TextRun({ text: "", size: 8 })], spacing: { before: 0, after: 80 } }));
              innerChildren.push(...builders.buildReglette(r));
            }
          }
        });
        // Paragraphe minuscule à la fin du wrapper : Word exige un paragraphe en fin de cellule,
        // et sans contrôle de notre part docx-js insère un paragraphe par défaut (size 22) qui
        // crée un espace blanc important entre le wrapper et le premier document.
        innerChildren.push(new Paragraph({ children: [new TextRun({ text: "", size: 4 })], spacing: { before: 0, after: 0 } }));

        // Enveloppe : 1 cellule sans bordure, cantSplit:true → impossible de couper entre pages
        bodyChildren.push(new Table({
          width: { size: 10500, type: WidthType.DXA },
          columnWidths: [10500],
          rows: [new TableRow({
            cantSplit: true,
            children: [new TableCell({
              width: { size: 10500, type: WidthType.DXA },
              borders: WRAPPER_NO_BORDERS,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: innerChildren
            })]
          })]
        }));
      }

      // Documents : chacun dans son propre tableau cantSplit
      // Plus de saut de page forcé : Word emballe naturellement les documents
      // avec l'énoncé tant qu'il y a de la place. Les wrappers cantSplit empêchent
      // qu'un document soit coupé entre deux pages.
      const docPieces = g.pieces.filter(p => p.kind === 'document');

      // Stratégie d'emballage : grouper les docs consécutifs « étroits » par paires
      // pour les afficher côte à côte (2 colonnes). Doc « étroit » = image ≤ 7 cm OU texte seul.
      const isDocNarrow = (d) => !d.imageUrl || (d.imageWidthCm || 12) <= 7;
      const slots = [];
      let dIdx = 0;
      while (dIdx < docPieces.length) {
        const d1 = q.documents.find(x => x.id === docPieces[dIdx].pieceId);
        if (!d1) { dIdx++; continue; }
        const d2 = dIdx + 1 < docPieces.length ? q.documents.find(x => x.id === docPieces[dIdx + 1].pieceId) : null;
        if (d2 && isDocNarrow(d1) && isDocNarrow(d2)) {
          slots.push({ kind: 'pair', docs: [d1, d2] });
          dIdx += 2;
        } else {
          slots.push({ kind: 'single', docs: [d1] });
          dIdx++;
        }
      }

      // Espace minimaliste entre l'énoncé/réglette et les documents
      // Police minuscule (size: 8 = 4pt) → hauteur de ligne réduite
      if (slots.length > 0) {
        bodyChildren.push(new Paragraph({
          children: [new TextRun({ text: "", size: 8 })],
          spacing: { before: 0, after: 60 }
        }));
      }

      slots.forEach((slot, sIdx) => {
        if (sIdx > 0) {
          bodyChildren.push(new Paragraph({
            children: [new TextRun({ text: "", size: 8 })],
            spacing: { before: 0, after: 60 }
          }));
        }
        if (slot.kind === 'single') {
          bodyChildren.push(...builders.buildDocument(slot.docs[0]));
        } else {
          bodyChildren.push(builders.buildPairedDocuments(slot.docs[0], slot.docs[1]));
        }
      });
    });

    const doc = new Document({
      creator: "HEC Premier cycle",
      title: "Cahier de l'élève",
      styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            // Marges resserrées (720 twips = 1,27 cm) pour maximiser l'espace de contenu
            margin: { top: 720, right: 720, bottom: 720, left: 720 }
          }
        },
        headers: undefined,
        children: bodyChildren.length > 0 ? bodyChildren : [new Paragraph({ children: [new TextRun("(vide)")] })]
      }]
    });

    return await Packer.toBlob(doc);
  }

  // ====== VARIANTE : CAHIER « DOCUMENTS À LA FIN » (test) ======
  // Structure : pour chaque question, énoncé → espace de réponse → réglette (sans documents
  // intercalés). TOUS les documents du cahier sont regroupés en fin de cahier et renumérotés
  // globalement 1, 2, 3, … L'espace est maximisé : aucune question ne démarre sur une page neuve
  // (les questions s'enchaînent), et les documents étroits sont appariés côte à côte.

  // Renumérote les renvois « document(s) <liste> » d'un texte selon une table local→global.
  // La regex ne capture que la liste de nombres collée à « document(s) » et s'arrête au 1er
  // token non-liste : les années entre parenthèses et autres nombres sont préservés. Couvre
  // aussi les « Document N » des espaces de réponse / corrigés, ET les titres « Document N : légende »
  // (seul le numéro est remplacé ; la légende est conservée).
  function makeDocRenumberer(map) {
    return function (text) {
      if (typeof text !== 'string' || !text) return text;
      return text.replace(
        /(\bdocuments?\b\s+)(\d+(?:\s*(?:,\s*|\s+à\s+|\s+et\s+)\d+)*)/gi,
        (m, head, list) => head + list.replace(/\d+/g, d => {
          const g = map[parseInt(d, 10)];
          return g != null ? String(g) : d;
        })
      );
    };
  }

  // Applique le renuméroteur récursivement à toutes les chaînes d'une valeur (clone immuable).
  function deepRenumber(value, ren) {
    if (typeof value === 'string') return ren(value);
    if (Array.isArray(value)) return value.map(v => deepRenumber(v, ren));
    if (value && typeof value === 'object') {
      const out = {};
      for (const k in value) out[k] = deepRenumber(value[k], ren);
      return out;
    }
    return value;
  }

  // Copie de la question avec énoncé + espace de réponse renumérotés (la question source intacte).
  function renumberQuestion(q, map) {
    const ren = makeDocRenumberer(map);
    const b = q.questionBody || {};
    return {
      ...q,
      questionBody: {
        ...b,
        prompt: ren(b.prompt),
        bullets: b.bullets ? b.bullets.map(ren) : b.bullets,
        instructions: b.instructions ? deepRenumber(b.instructions, ren) : b.instructions,
        responseSpace: b.responseSpace ? deepRenumber(b.responseSpace, ren) : b.responseSpace
      }
    };
  }

  // Numéro local d'un document : lu dans son titre (« Document 3 : … » → 3), sinon position.
  // Les titres HEC portent une légende (« Document 1 : Les 95 thèses ») et pickDocs peut conserver
  // des numéros non contigus (« Document 4 », « Document 5 ») : lire le titre est donc la source fiable.
  function localDocNumber(doc, fallbackIdx) {
    const m = doc && typeof doc.title === 'string' ? doc.title.match(/(\d+)/) : null;
    return m ? parseInt(m[1], 10) : (fallbackIdx + 1);
  }

  async function buildDocxBlobFlat() {
    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      BorderStyle, WidthType, PageBreak
    } = docx;

    const imageCache = await preloadImages();
    const builders = makeBuilders(docx, imageCache);

    const coverElements = buildCoverPage(docx);

    // Grouper les pièces du cahier par question (consécutivement)
    const groups = [];
    let cur = null;
    state.cahier.forEach(p => {
      if (!cur || cur.questionId !== p.questionId) {
        cur = { questionId: p.questionId, pieces: [] };
        groups.push(cur);
      }
      cur.pieces.push(p);
    });

    const NO_B = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const WRAPPER_NO_BORDERS = { top: NO_B, bottom: NO_B, left: NO_B, right: NO_B };

    // ---- PASSE 1 : numérotation globale des documents + table local→global par question ----
    let globalDoc = 0;
    const endDocs = []; // { doc (titre renuméroté, légende conservée), narrow }
    const isDocNarrow = (d) => !d.imageUrl || (d.imageWidthCm || 12) <= 7;
    groups.forEach(g => {
      const q = DATA.questions.find(x => x.id === g.questionId);
      g._map = {};
      if (!q) return;
      const presentIds = new Set(g.pieces.filter(p => p.kind === 'document').map(p => p.pieceId));
      const ren = makeDocRenumberer(g._map);
      q.documents.forEach((doc, idx) => {
        if (!presentIds.has(doc.id)) return;
        globalDoc++;
        const local = localDocNumber(doc, idx);
        g._map[local] = globalDoc;
        // Titre renuméroté en conservant la légende : « Document 1 : Les 95 thèses » → « Document 7 : Les 95 thèses »
        endDocs.push({ doc: { ...doc, title: ren(doc.title) }, narrow: isDocNarrow(doc) });
      });
    });

    const bodyChildren = [];
    bodyChildren.push(...coverElements);
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));

    // ---- PASSE 2 : énoncés (question → espace de réponse → réglette), AUCUN document intercalé ----
    groups.forEach((g, idx) => {
      const q0 = DATA.questions.find(x => x.id === g.questionId);
      if (!q0) return;
      const q = renumberQuestion(q0, g._map);
      const seqNumero = idx + 1;

      const corePieces = g.pieces.filter(p => p.kind === 'questionBody' || p.kind === 'reglette');
      const coreChildren = [];
      corePieces.forEach(p => {
        if (p.kind === 'questionBody') {
          coreChildren.push(...builders.buildQuestionBody(q, seqNumero));
        } else if (p.kind === 'reglette') {
          const r = q.reglettes.find(x => x.id === p.pieceId);
          if (r) {
            coreChildren.push(new Paragraph({ children: [new TextRun({ text: "", size: 8 })], spacing: { before: 0, after: 80 } }));
            coreChildren.push(...builders.buildReglette(r));
          }
        }
      });
      if (coreChildren.length === 0) return;
      coreChildren.push(new Paragraph({ children: [new TextRun({ text: "", size: 4 })], spacing: { before: 0, after: 0 } }));

      // Enveloppe cantSplit : la question ne se coupe pas entre deux pages.
      // PAS de saut de page forcé → les questions s'enchaînent pour densifier le cahier.
      bodyChildren.push(new Table({
        width: { size: 10500, type: WidthType.DXA },
        columnWidths: [10500],
        rows: [new TableRow({
          cantSplit: true,
          children: [new TableCell({
            width: { size: 10500, type: WidthType.DXA },
            borders: WRAPPER_NO_BORDERS,
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            children: coreChildren
          })]
        })]
      }));
      // Mince séparateur entre deux questions
      bodyChildren.push(new Paragraph({ children: [new TextRun({ text: "", size: 12 })], spacing: { before: 0, after: 120 } }));
    });

    // ---- DOCUMENTS REGROUPÉS À LA FIN (numérotés 1..N), appariés si étroits ----
    if (endDocs.length > 0) {
      bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));
      bodyChildren.push(new Paragraph({
        children: [new TextRun({ text: "Documents", bold: true, size: 32, color: "8B3A2E" })],
        spacing: { after: 160 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "8B3A2E", space: 4 } }
      }));

      const slots = [];
      let i = 0;
      while (i < endDocs.length) {
        const a = endDocs[i];
        const b = (i + 1 < endDocs.length) ? endDocs[i + 1] : null;
        if (b && a.narrow && b.narrow) { slots.push([a.doc, b.doc]); i += 2; }
        else { slots.push([a.doc]); i += 1; }
      }
      slots.forEach((slot, sIdx) => {
        if (sIdx > 0) {
          bodyChildren.push(new Paragraph({ children: [new TextRun({ text: "", size: 8 })], spacing: { before: 0, after: 80 } }));
        }
        if (slot.length === 1) bodyChildren.push(...builders.buildDocument(slot[0]));
        else bodyChildren.push(builders.buildPairedDocuments(slot[0], slot[1]));
      });
    }

    const doc = new Document({
      creator: "HEC Premier cycle",
      title: "Cahier de l'élève (variante — documents à la fin)",
      styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 720, right: 720, bottom: 720, left: 720 }
          }
        },
        headers: undefined,
        children: bodyChildren.length > 0 ? bodyChildren : [new Paragraph({ children: [new TextRun("(vide)")] })]
      }]
    });

    return await Packer.toBlob(doc);
  }

  // ====== GÉNÉRATION DU GUIDE DE L'ENSEIGNANT (corrigé) ======
  // Mise en page concise : pas de page couverture, pas de documents, pas d'espace de réponse vide.
  // Chaque question : titre + énoncé + corrigé surligné + réglette compacte.
  async function buildCorrigeBlob(flat) {
    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign, PageBreak
    } = docx;

    const TEXT_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
    const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const ALL_BORDERS = { top: TEXT_BORDER, bottom: TEXT_BORDER, left: TEXT_BORDER, right: TEXT_BORDER };
    const CELL_MARGINS = { top: 80, bottom: 80, left: 120, right: 120 };

    // Grouper les pièces par question (on conserve les pièces pour pouvoir, en mode variante,
    // compter les documents réellement présents — strictement la même logique que le cahier variante).
    const groups = [];
    let cur = null;
    state.cahier.forEach(p => {
      if (!cur || cur.questionId !== p.questionId) {
        cur = { questionId: p.questionId, pieces: [] };
        groups.push(cur);
      }
      cur.pieces.push(p);
    });

    // MODE VARIANTE : numérotation globale des documents, IDENTIQUE à buildDocxBlobFlat
    // (mêmes pièces-documents comptées, dans le même ordre) → les renvois du guide concordent
    // exactement avec le cahier variante. Le guide n'affiche pas les documents pour autant.
    if (flat) {
      let globalDoc = 0;
      groups.forEach(g => {
        const q = DATA.questions.find(x => x.id === g.questionId);
        g._map = {};
        if (!q) return;
        const presentIds = new Set((g.pieces || []).filter(p => p.kind === 'document').map(p => p.pieceId));
        q.documents.forEach((doc, i) => {
          if (!presentIds.has(doc.id)) return;
          globalDoc++;
          g._map[localDocNumber(doc, i)] = globalDoc;
        });
      });
    }

    const bodyChildren = [];

    // Déterminer le titre dynamique selon les questions sélectionnées (même logique que la couverture du cahier)
    const corrNiveaux = new Set();
    const corrRealites = new Set();
    groups.forEach(g => {
      const q = DATA.questions.find(x => x.id === g.questionId);
      if (q) {
        corrNiveaux.add(q.niveau);
        corrRealites.add(q.realite_sociale_id);
      }
    });
    const corrUniformNiveau = corrNiveaux.size === 1 ? [...corrNiveaux][0] : null;
    const corrUniformRealiteId = corrRealites.size === 1 ? [...corrRealites][0] : null;
    const corrUniformRealiteTitre = corrUniformRealiteId
      ? (DATA.realites_sociales.find(r => r.id === corrUniformRealiteId) || {}).titre
      : null;

    // Construire le sous-titre selon ce qui est sélectionné
    let subtitleText;
    if (corrUniformRealiteTitre && corrUniformNiveau != null) {
      subtitleText = `${corrUniformRealiteTitre} · Secondaire ${corrUniformNiveau}`;
    } else if (corrUniformRealiteTitre) {
      subtitleText = corrUniformRealiteTitre;
    } else if (corrRealites.size > 1) {
      const titres = [...corrRealites]
        .map(id => (DATA.realites_sociales.find(r => r.id === id) || {}).titre)
        .filter(Boolean);
      subtitleText = titres.join(' · ');
    } else {
      subtitleText = '';
    }

    // Titre du guide
    bodyChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 100 },
      children: [new TextRun({ text: "GUIDE DE L'ENSEIGNANT", bold: true, size: 36, color: "2A2620" })]
    }));
    if (subtitleText) {
      bodyChildren.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 200 },
        children: [new TextRun({ text: subtitleText, italics: true, size: 22, color: "6E685C" })]
      }));
    }
    bodyChildren.push(new Paragraph({
      spacing: { before: 0, after: 300 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: "8B3A2E", space: 4 } },
      children: [new TextRun({ text: "" })]
    }));

    groups.forEach((g, idx) => {
      const qRaw = DATA.questions.find(x => x.id === g.questionId);
      if (!qRaw) return;
      // En mode variante : renumérotation globale de l'énoncé, de l'espace de réponse ET du
      // corrigé (les corrigés du type ["Document 4","Document 5"] / {before:[…]} passent par
      // la même règle « Document N → Document N+décalage »).
      const q = flat
        ? (function () {
            const base = renumberQuestion(qRaw, g._map || {});
            return { ...base, corrige: deepRenumber(qRaw.corrige, makeDocRenumberer(g._map || {})) };
          })()
        : qRaw;
      const seqNumero = idx + 1;

      // Titre concis : "Question N"
      bodyChildren.push(new Paragraph({
        spacing: { before: 200, after: 60 },
        keepNext: true,
        children: [
          new TextRun({ text: `Question #${seqNumero}`, bold: true, size: 26, color: "8B3A2E" })
        ]
      }));

      // Énoncé (prompt + bullets s'il y en a, sans les instructions de format)
      bodyChildren.push(new Paragraph({
        spacing: { after: 60 },
        keepNext: true,
        children: [new TextRun({ text: q.questionBody.prompt, size: 22 })]
      }));

      if (q.questionBody.bullets) {
        q.questionBody.bullets.forEach(b => {
          bodyChildren.push(new Paragraph({
            spacing: { after: 20 },
            children: [new TextRun({ text: "• " + b, size: 22 })],
            indent: { left: 360 }
          }));
        });
      }

      // Bloc CORRIGÉ — fond beige, bordure burgundy, texte rouge
      bodyChildren.push(...buildCorrigeBlock(docx, q));

      // Réglette compacte
      if (q.reglettes && q.reglettes.length > 0) {
        const r = q.reglettes[0];
        // Petite réglette avec une seule ligne de barème
        if (r.type === 'simple' && r.levels) {
          const totalW = 9000;
          const cellW = Math.floor(totalW / r.levels.length);
          const cells = r.levels.map(lvl => {
            // Isoler « (N sur M) » sur sa propre ligne en italique gris (même règle que la version cahier).
            const countMatch = lvl.condition.match(/\s*(\([^)]*sur[^)]*\))\s*\.?\s*$/i);
            const mainText = countMatch
              ? lvl.condition.slice(0, countMatch.index).replace(/\s+$/, '')
              : lvl.condition;
            const countText = countMatch ? countMatch[1] : null;
            const paragraphs = [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: lvl.points, bold: true, size: 16 })] }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: countText ? 40 : 0 },
                children: [new TextRun({ text: mainText, size: 14 })]
              })
            ];
            if (countText) {
              paragraphs.push(new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: countText, size: 14, color: "6E685C", italics: true })]
              }));
            }
            return new TableCell({
              width: { size: cellW, type: WidthType.DXA },
              borders: ALL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              margins: CELL_MARGINS,
              children: paragraphs
            });
          });
          bodyChildren.push(new Table({
            width: { size: totalW, type: WidthType.DXA },
            columnWidths: r.levels.map(() => cellW),
            rows: [new TableRow({ children: cells })]
          }));
        } else if (r.type === 'complex') {
          // Pour la causalité : on liste seulement le max et le min de manière compacte
          bodyChildren.push(new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({ text: "Barème : ", bold: true, size: 16, color: "6E685C" }),
              new TextRun({ text: `${r.maxPoints} points (rubrique causalité détaillée)`, italics: true, size: 16, color: "6E685C" })
            ]
          }));
        }
      }
    });

    const doc = new Document({
      creator: "HEC Premier cycle — Guide de l'enseignant",
      title: "Guide de l'enseignant",
      styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 900, right: 1080, bottom: 900, left: 1080 }
          }
        },
        children: bodyChildren.length > 0 ? bodyChildren : [new Paragraph({ children: [new TextRun("(vide)")] })]
      }]
    });

    return await Packer.toBlob(doc);
  }

  // ====== BLOC CORRIGÉ (rendu adaptatif selon le type de réponse) ======
  function buildCorrigeBlock(d, q) {
    const { Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign } = d;
    const out = [];
    if (q.corrige === undefined || q.corrige === null) {
      out.push(new Paragraph({
        spacing: { before: 80, after: 100 },
        children: [new TextRun({ text: "[Corrigé non disponible]", italics: true, color: "999999", size: 18 })]
      }));
      return out;
    }

    const rs = q.questionBody.responseSpace;
    const SHADING = { fill: "FDF6EC", type: ShadingType.CLEAR, color: "auto" };
    const ANSWER_BORDER = { style: BorderStyle.SINGLE, size: 6, color: "8B3A2E" };
    const ANSWER_BORDERS = { top: ANSWER_BORDER, bottom: ANSWER_BORDER, left: ANSWER_BORDER, right: ANSWER_BORDER };
    const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const ANSWER_CELL_MARGINS = { top: 120, bottom: 120, left: 160, right: 160 };

    // 1) Texte simple (réponse type "lines")
    if (typeof q.corrige === 'string') {
      out.push(new Paragraph({
        spacing: { before: 80, after: 40 },
        children: [new TextRun({ text: "✓ Corrigé", bold: true, size: 18, color: "8B3A2E" })]
      }));
      out.push(new Table({
        width: { size: 9000, type: WidthType.DXA }, columnWidths: [9000],
        rows: [new TableRow({ cantSplit: true, children: [new TableCell({
          width: { size: 9000, type: WidthType.DXA },
          borders: ANSWER_BORDERS, shading: SHADING, margins: ANSWER_CELL_MARGINS,
          children: [
            new Paragraph({ children: [new TextRun({ text: q.corrige, size: 20 })] })
          ]
        })] })]
      }));
      return out;
    }

    // 2) Réponse "labeled-list" : tableau item / valeur
    if (rs && rs.type === 'labeled-list' && Array.isArray(q.corrige)) {
      const rows = (rs.items || []).map((item, i) => new TableRow({ children: [
        new TableCell({
          width: { size: 5400, type: WidthType.DXA }, borders: ANSWER_BORDERS, shading: SHADING,
          verticalAlign: VerticalAlign.CENTER, margins: ANSWER_CELL_MARGINS,
          children: [new Paragraph({ children: [new TextRun({ text: item, size: 20 })] })]
        }),
        new TableCell({
          width: { size: 3600, type: WidthType.DXA }, borders: ANSWER_BORDERS, shading: SHADING,
          verticalAlign: VerticalAlign.CENTER, margins: ANSWER_CELL_MARGINS,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: q.corrige[i] || '—', bold: true, size: 22, color: "8B3A2E" })] })]
        })
      ] }));
      out.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: "✓ Corrigé", bold: true, size: 18, color: "8B3A2E" })] }));
      out.push(new Table({ width: { size: 9000, type: WidthType.DXA }, columnWidths: [5400, 3600], rows }));
      return out;
    }

    // 2b) Réponse "chrono-ordering" : N cases avec flèches, étiquettes au-dessus,
    //     réponses dans les cases (sans le libellé qui est désormais hors de la case).
    if (rs && rs.type === 'chrono-ordering' && Array.isArray(q.corrige)) {
      const items = rs.items || [];
      const n = items.length;
      const totalW = 9000;
      const arrowW = 450;
      const boxW = Math.floor((totalW - (n - 1) * arrowW) / n);
      const widths = [];
      const labelRow = [];
      const boxRow = [];
      items.forEach((label, i) => {
        widths.push(boxW);
        labelRow.push(new TableCell({
          width: { size: boxW, type: WidthType.DXA },
          borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
          verticalAlign: VerticalAlign.BOTTOM,
          margins: { top: 0, bottom: 60, left: 0, right: 0 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: label, size: 14, italics: true, color: "6E685C" })]
          })]
        }));
        boxRow.push(new TableCell({
          width: { size: boxW, type: WidthType.DXA },
          borders: ANSWER_BORDERS, shading: SHADING,
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 120, bottom: 120, left: 80, right: 80 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: q.corrige[i] || '—', bold: true, size: 22, color: "8B3A2E" })]
          })]
        }));
        if (i < n - 1) {
          widths.push(arrowW);
          labelRow.push(new TableCell({
            width: { size: arrowW, type: WidthType.DXA },
            borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
            children: [new Paragraph({ children: [new TextRun({ text: "" })] })]
          }));
          boxRow.push(new TableCell({
            width: { size: arrowW, type: WidthType.DXA },
            borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: "→", size: 32, bold: true })]
            })]
          }));
        }
      });
      out.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: "✓ Corrigé", bold: true, size: 18, color: "8B3A2E" })] }));
      out.push(new Table({
        width: { size: totalW, type: WidthType.DXA },
        columnWidths: widths,
        rows: [
          new TableRow({ children: labelRow }),
          new TableRow({ height: { value: 800, rule: "atLeast" }, children: boxRow })
        ]
      }));
      return out;
    }

    // 2c) Réponse "before-after-axis" : axe à 3 boîtes (Antériorité ← pivot → Postériorité).
    //     Dans le corrigé, les boîtes latérales contiennent les documents corrects.
    //     q.corrige attendu : { before: [string, ...], after: [string, ...] }
    if (rs && rs.type === 'before-after-axis' && q.corrige && typeof q.corrige === 'object' && !Array.isArray(q.corrige)) {
      const beforeLabel = rs.beforeLabel || 'Antériorité (Avant)';
      const afterLabel  = rs.afterLabel  || 'Postériorité (Après)';
      const pivot       = rs.pivot       || '';
      const beforeAns   = (q.corrige.before || []).join(' · ');
      const afterAns    = (q.corrige.after  || []).join(' · ');
      const totalW = 9000;
      const arrowW = 400;
      const sideW = Math.floor((totalW - 2 * arrowW) * 0.32);
      const centerW = totalW - 2 * sideW - 2 * arrowW;
      const widths = [sideW, arrowW, centerW, arrowW, sideW];
      const baCells = [
        new TableCell({
          width: { size: sideW, type: WidthType.DXA },
          borders: ANSWER_BORDERS, shading: SHADING,
          verticalAlign: VerticalAlign.TOP,
          margins: { top: 100, bottom: 100, left: 80, right: 80 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 80 },
              children: [new TextRun({ text: beforeLabel, bold: true, size: 16, color: "6E685C" })]
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: beforeAns || '—', bold: true, size: 22, color: "8B3A2E" })]
            })
          ]
        }),
        new TableCell({
          width: { size: arrowW, type: WidthType.DXA },
          borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "←", size: 30, bold: true })] })]
        }),
        new TableCell({
          width: { size: centerW, type: WidthType.DXA },
          borders: ANSWER_BORDERS,
          shading: { fill: "F5EFE2", type: ShadingType.CLEAR, color: "auto" },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 120, bottom: 120, left: 100, right: 100 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: pivot, bold: true, size: 18 })]
          })]
        }),
        new TableCell({
          width: { size: arrowW, type: WidthType.DXA },
          borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "→", size: 30, bold: true })] })]
        }),
        new TableCell({
          width: { size: sideW, type: WidthType.DXA },
          borders: ANSWER_BORDERS, shading: SHADING,
          verticalAlign: VerticalAlign.TOP,
          margins: { top: 100, bottom: 100, left: 80, right: 80 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 80 },
              children: [new TextRun({ text: afterLabel, bold: true, size: 16, color: "6E685C" })]
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: afterAns || '—', bold: true, size: 22, color: "8B3A2E" })]
            })
          ]
        })
      ];
      out.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: "✓ Corrigé", bold: true, size: 18, color: "8B3A2E" })] }));
      out.push(new Table({
        width: { size: totalW, type: WidthType.DXA },
        columnWidths: widths,
        rows: [new TableRow({ height: { value: 1000, rule: "atLeast" }, children: baCells })]
      }));
      return out;
    }

    // 3) Réponse "checkbox-table" : montre le tableau avec cases cochées (☒) / non cochées (☐)
    if (rs && rs.type === 'checkbox-table' && Array.isArray(q.corrige)) {
      const cols = rs.columns || []; const rowItems = rs.rows || [];
      const totalW = 9000, firstColW = 3600;
      const otherColW = Math.floor((totalW - firstColW) / Math.max(cols.length, 1));
      const headerCells = [
        new TableCell({ width: { size: firstColW, type: WidthType.DXA }, borders: ANSWER_BORDERS, shading: SHADING,
          margins: ANSWER_CELL_MARGINS, children: [new Paragraph({ children: [new TextRun({ text: "" })] })] }),
        ...cols.map(c => new TableCell({ width: { size: otherColW, type: WidthType.DXA }, borders: ANSWER_BORDERS, shading: SHADING,
          verticalAlign: VerticalAlign.CENTER, margins: ANSWER_CELL_MARGINS,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c, bold: true, size: 18 })] })] }))
      ];
      const trows = [new TableRow({ children: headerCells, tableHeader: true })];
      rowItems.forEach((item, ri) => {
        const checks = q.corrige[ri] || [];
        const cells = [
          new TableCell({ width: { size: firstColW, type: WidthType.DXA }, borders: ANSWER_BORDERS, shading: SHADING,
            verticalAlign: VerticalAlign.CENTER, margins: ANSWER_CELL_MARGINS,
            children: [new Paragraph({ children: [new TextRun({ text: item, size: 20 })] })] }),
          ...cols.map((_, ci) => new TableCell({ width: { size: otherColW, type: WidthType.DXA }, borders: ANSWER_BORDERS, shading: SHADING,
            verticalAlign: VerticalAlign.CENTER, margins: ANSWER_CELL_MARGINS,
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: checks[ci] ? "☒" : "☐", bold: true, size: 32, color: checks[ci] ? "8B3A2E" : "999999" })] })] }))
        ];
        trows.push(new TableRow({ children: cells }));
      });
      out.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: "✓ Corrigé", bold: true, size: 18, color: "8B3A2E" })] }));
      out.push(new Table({ width: { size: totalW, type: WidthType.DXA }, columnWidths: [firstColW, ...cols.map(() => otherColW)], rows: trows }));
      return out;
    }

    // Fallback : afficher la valeur brute
    out.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: "✓ Corrigé : ", bold: true, color: "8B3A2E", size: 18 })] }));
    out.push(new Paragraph({ children: [new TextRun({ text: JSON.stringify(q.corrige), size: 20 })] }));
    return out;
  }

  // ====== PAGE COUVERTURE ======
  function buildCoverPage(d) {
    const {
      Paragraph, TextRun, Table, TableRow, TableCell,
      AlignmentType, BorderStyle, WidthType, VerticalAlign
    } = d;

    const TEXT_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
    const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

    const totalPoints = computeCahierPoints();

    // Détection uniformité niveau / réalité sociale
    const niveaux = new Set();
    const realites = new Set();
    state.cahier.forEach(p => {
      const q = DATA.questions.find(x => x.id === p.questionId);
      if (q) {
        niveaux.add(q.niveau);
        realites.add(q.realite_sociale_id);
      }
    });
    const uniformNiveau = niveaux.size === 1 ? [...niveaux][0] : null;
    const uniformRealiteId = realites.size === 1 ? [...realites][0] : null;
    const uniformRealite = uniformRealiteId
      ? (DATA.realites_sociales.find(r => r.id === uniformRealiteId) || {}).titre
      : null;

    const out = [];

    // Espacement vertical pour pousser le contenu vers le centre/haut
    out.push(new Paragraph({
      children: [new TextRun({ text: "" })],
      spacing: { before: 2400 }
    }));

    // Titre principal
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 100 },
      children: [new TextRun({ text: "CAHIER DE L'ÉLÈVE", bold: true, size: 56, color: "2A2620" })]
    }));

    // Sous-titre programmatique
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 240 },
      children: [new TextRun({
        text: "Histoire et éducation à la citoyenneté",
        italics: true, size: 24, color: "6E685C"
      })]
    }));

    // Trait d'accent burgundy
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 16, color: "8B3A2E", space: 4 } },
      children: [new TextRun({ text: "" })]
    }));

    // Niveau
    if (uniformNiveau) {
      out.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 120 },
        children: [new TextRun({ text: `Secondaire ${uniformNiveau}`, bold: true, size: 32 })]
      }));
    }
    // Réalité sociale
    if (uniformRealite) {
      out.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 900 },
        children: [new TextRun({ text: uniformRealite, italics: true, size: 28 })]
      }));
    } else {
      out.push(new Paragraph({ children: [new TextRun({ text: "" })], spacing: { after: 900 } }));
    }

    // Champs : Nom, Groupe, Date — tableau 2 colonnes
    const fieldRow = (label) => new TableRow({
      height: { value: 600, rule: "atLeast" },
      children: [
        new TableCell({
          width: { size: 2000, type: WidthType.DXA },
          borders: NO_BORDERS,
          verticalAlign: VerticalAlign.BOTTOM,
          margins: { top: 120, bottom: 120, left: 0, right: 240 },
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: `${label} :`, bold: true, size: 28 })]
          })]
        }),
        new TableCell({
          width: { size: 5500, type: WidthType.DXA },
          borders: { top: NO_BORDER, bottom: TEXT_BORDER, left: NO_BORDER, right: NO_BORDER },
          margins: { top: 120, bottom: 120, left: 0, right: 0 },
          children: [new Paragraph({ children: [new TextRun({ text: "" })] })]
        })
      ]
    });
    out.push(new Table({
      width: { size: 7500, type: WidthType.DXA },
      columnWidths: [2000, 5500],
      alignment: AlignmentType.CENTER,
      rows: [fieldRow('Nom'), fieldRow('Groupe'), fieldRow('Date')]
    }));

    // Espace puis bloc Total — tableau 3 colonnes : "Total :" / ligne / "/ N points"
    out.push(new Paragraph({
      children: [new TextRun({ text: "" })],
      spacing: { before: 1400 }
    }));

    out.push(new Table({
      width: { size: 5800, type: WidthType.DXA },
      columnWidths: [1700, 2200, 1900],
      alignment: AlignmentType.CENTER,
      rows: [new TableRow({
        height: { value: 700, rule: "atLeast" },
        children: [
          new TableCell({
            width: { size: 1700, type: WidthType.DXA },
            borders: NO_BORDERS,
            verticalAlign: VerticalAlign.BOTTOM,
            margins: { top: 120, bottom: 120, left: 0, right: 200 },
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: "Total :", bold: true, size: 32 })]
            })]
          }),
          new TableCell({
            width: { size: 2200, type: WidthType.DXA },
            borders: { top: NO_BORDER, bottom: TEXT_BORDER, left: NO_BORDER, right: NO_BORDER },
            verticalAlign: VerticalAlign.BOTTOM,
            margins: { top: 120, bottom: 120, left: 0, right: 0 },
            children: [new Paragraph({ children: [new TextRun({ text: "" })] })]
          }),
          new TableCell({
            width: { size: 1900, type: WidthType.DXA },
            borders: NO_BORDERS,
            verticalAlign: VerticalAlign.BOTTOM,
            margins: { top: 120, bottom: 120, left: 200, right: 0 },
            children: [new Paragraph({
              alignment: AlignmentType.LEFT,
              children: [new TextRun({ text: `/ ${totalPoints} points`, bold: true, size: 32, color: "8B3A2E" })]
            })]
          })
        ]
      })]
    }));

    return out;
  }

  async function generateDocx(download, corrige, variant) {
    if (state.cahier.length === 0) return;
    showLoading(
      variant && corrige ? 'Génération du guide (variante)…'
      : variant ? 'Génération du cahier (variante)…'
      : corrige ? 'Génération du guide de l\'enseignant…'
      : 'Génération du cahier…'
    );
    try {
      const blob = variant
        ? (corrige ? await buildCorrigeBlob(/*flat*/ true) : await buildDocxBlobFlat())
        : (corrige ? await buildCorrigeBlob() : await buildDocxBlob());
      const url = URL.createObjectURL(blob);
      if (download !== false) {
        const a = document.createElement('a');
        a.href = url;
        const date = new Date().toISOString().slice(0, 10);
        a.download = variant && corrige ? `HEC-guide-enseignant-variante-${date}.docx`
          : variant ? `HEC-cahier-variante-${date}.docx`
          : corrige ? `HEC-guide-enseignant-${date}.docx`
          : `HEC-cahier-${date}.docx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      }
      hideLoading();
      return blob;
    } catch (err) {
      hideLoading();
      console.error('Erreur lors de la génération du .docx :', err);
      alert('Une erreur est survenue lors de la génération.\n\n' + err.message);
    }
  }

  // ====== PRÉVISUALISATION ======
  // Utilise docx-preview pour un rendu fidèle du .docx (préserve bordures, couleurs, mises en page)
  async function previewCahier(corrige, variant) {
    if (state.cahier.length === 0) return;
    state.previewMode = variant ? (corrige ? 'variante-corrige' : 'variante') : corrige ? 'corrige' : 'cahier';
    showLoading(
      variant && corrige ? 'Préparation du guide (variante)…'
      : variant ? 'Préparation de l\'aperçu (variante)…'
      : corrige ? 'Préparation du guide…'
      : 'Préparation de l\'aperçu…'
    );
    try {
      const blob = variant
        ? (corrige ? await buildCorrigeBlob(/*flat*/ true) : await buildDocxBlobFlat())
        : (corrige ? await buildCorrigeBlob() : await buildDocxBlob());

      // Mettre à jour le titre et le bouton du modal selon le mode
      if (el.modalTitle) el.modalTitle.textContent =
        variant && corrige ? 'Aperçu — Guide de l\'enseignant (variante · documents à la fin)'
        : variant ? 'Aperçu — Cahier de l\'élève (variante · documents à la fin)'
        : corrige ? 'Aperçu — Guide de l\'enseignant'
        : 'Aperçu — Cahier de l\'élève';
      if (el.modalDownload) el.modalDownload.textContent =
        variant && corrige ? '⬇ Télécharger le guide (variante)'
        : variant ? '⬇ Télécharger la variante'
        : corrige ? '⬇ Télécharger le guide'
        : '⬇ Télécharger le cahier';

      // Vider le conteneur et y faire rendre le docx
      el.previewContainer.innerHTML = '';
      el.previewOverlay.hidden = false;
      document.body.style.overflow = 'hidden';

      await docxPreview.renderAsync(blob, el.previewContainer, null, {
        className: 'docx',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        experimental: false,
        trimXmlDeclaration: true,
        useBase64URL: true
      });

      // VARIANTE : l'aperçu n'affiche pas les coupures de page (docx-preview ne repagine pas
      // le texte qui s'enchaîne). On simule les coupures, sans toucher au .docx, une fois les
      // images chargées. Repli sûr : toute erreur est avalée et l'aperçu reste affiché.
      if (variant) {
        await awaitImages(el.previewContainer);
        simulatePageBreaks(el.previewContainer);
      }

      hideLoading();
    } catch (err) {
      hideLoading();
      console.error('Erreur lors de la prévisualisation :', err);
      alert('Erreur lors de la prévisualisation : ' + err.message);
    }
  }

  // Attend le chargement de toutes les images du conteneur (pour mesurer des hauteurs justes).
  function awaitImages(container) {
    const imgs = Array.from(container.querySelectorAll('img'));
    return Promise.all(imgs.map(img => (img.complete && img.naturalHeight !== 0)
      ? Promise.resolve()
      : new Promise(res => {
          img.addEventListener('load', res, { once: true });
          img.addEventListener('error', res, { once: true });
          setTimeout(res, 3000); // garde-fou
        })
    ));
  }

  // Simule les coupures de page dans l'aperçu de la variante (affichage seulement).
  // Principe : chaque bloc de premier niveau est insécable (enveloppe cantSplit pour les
  // questions, tableau unique pour chaque document) — exactement comme Word les traite. On
  // empile les blocs et, dès qu'un bloc déborde la hauteur utile d'une page, on insère une
  // coupure AVANT lui (comble + ligne pointillée + n° de page), reproduisant la pagination de Word.
  // docx-preview rend : <section class="docx" style="min-height:<page>; padding:<marges>"> <article> blocs… </article>.
  // La hauteur utile = minHeight de la section − marges haut/bas ; les blocs sont les enfants de l'<article>.
  function simulatePageBreaks(container) {
    try {
      const sections = container.querySelectorAll('section.docx');
      if (!sections.length) return;
      sections.forEach(section => {
        // Les blocs sont les enfants de l'<article> (docx-preview rend : section.docx > article > blocs).
        const article = section.querySelector(':scope > article') || section;

        // Hauteur utile de page, en PX (cohérent avec offsetHeight) et indépendante de l'unité
        // que getComputedStyle renvoie : on part de la largeur de contenu rendue (toujours en px)
        // × le ratio réel du contenu de page du .docx — contenu = (12240−1440) twips de large
        // × (15840−1440) twips de haut, soit 14400/10800.
        const contentWidthPx = (article.clientWidth || section.clientWidth || 0);
        const pageContentHeightPx = contentWidthPx * (14400 / 10800);
        if (!(pageContentHeightPx > 0)) return;

        const blocks = Array.from(article.children);
        if (blocks.length < 2) return;

        // Mesurer toutes les hauteurs AVANT toute insertion (évite tout effet de reflux).
        const heights = blocks.map(b => {
          const bcs = getComputedStyle(b);
          return b.offsetHeight + (parseFloat(bcs.marginTop) || 0) + (parseFloat(bcs.marginBottom) || 0);
        });

        let acc = 0, pageNo = 1;
        blocks.forEach((block, i) => {
          const h = heights[i];
          if (i > 0 && acc + h > pageContentHeightPx) {
            const remaining = Math.max(0, pageContentHeightPx - acc);
            const spacer = document.createElement('div');
            spacer.className = 'page-sim-spacer';
            spacer.style.height = remaining + 'px';
            pageNo++;
            const brk = document.createElement('div');
            brk.className = 'page-sim-break';
            brk.setAttribute('data-page', 'Page ' + pageNo);
            article.insertBefore(spacer, block);
            article.insertBefore(brk, block);
            acc = 0;
          }
          acc += h;
          if (h > pageContentHeightPx) acc = 0; // bloc plus grand qu'une page : on repart à 0
        });
      });
    } catch (e) {
      console.warn('Simulation de pages (aperçu) ignorée :', e);
    }
  }

  function closePreview() {
    el.previewOverlay.hidden = true;
    document.body.style.overflow = '';
    el.previewContainer.innerHTML = '';
  }

  // Précharge les images (bytes + dimensions naturelles) référencées dans les pièces sélectionnées
  async function preloadImages() {
    const cache = {};
    const urls = new Set();
    state.cahier.forEach(p => {
      const q = DATA.questions.find(x => x.id === p.questionId);
      if (!q) return;
      if (p.kind === 'document') {
        const d = q.documents.find(x => x.id === p.pieceId);
        if (d && d.imageUrl) urls.add(d.imageUrl);
      }
    });

    // Lit la largeur et la hauteur directement dans le fichier image, sans dépendre
    // du navigateur. Gère les PNG ET les JPG (les deux formats les plus courants).
    function detectImageFormat(bytes) {
      if (!bytes || bytes.length < 4) return null;
      if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'png';
      if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpg';
      return null;
    }
    // PNG : signature 8 octets puis chunk IHDR ; largeur aux octets 16-19, hauteur 20-23 (big-endian).
    function readPngDimensions(bytes) {
      if (!bytes || bytes.length < 24) return null;
      const view = new DataView(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
      const width = view.getUint32(16, false);
      const height = view.getUint32(20, false);
      if (!width || !height) return null;
      return { width, height };
    }
    // JPG : on parcourt les marqueurs jusqu'au segment « Start Of Frame » (SOFn),
    // qui contient la hauteur (2 octets) puis la largeur (2 octets).
    function readJpegDimensions(bytes) {
      if (!bytes || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
      let off = 2; const len = bytes.length;
      while (off + 1 < len) {
        if (bytes[off] !== 0xFF) { off++; continue; }
        let marker = bytes[off + 1];
        while (marker === 0xFF && off + 1 < len) { off++; marker = bytes[off + 1]; }
        off += 2;
        // marqueurs sans contenu (SOI, EOI, RSTn) : on continue
        if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) continue;
        if (off + 1 >= len) break;
        const segLen = (bytes[off] << 8) | bytes[off + 1];
        // SOFn (dimensions) : 0xC0–0xCF sauf 0xC4, 0xC8, 0xCC
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          if (off + 6 < len) {
            const height = (bytes[off + 3] << 8) | bytes[off + 4];
            const width  = (bytes[off + 5] << 8) | bytes[off + 6];
            if (width && height) return { width, height };
          }
          return null;
        }
        off += segLen; // sauter ce segment
      }
      return null;
    }

    await Promise.all(Array.from(urls).map(async (url) => {
      try {
        const buf = await fetch(url).then(r => r.arrayBuffer());
        const bytes = new Uint8Array(buf);
        const format = detectImageFormat(bytes);
        const dims = (format === 'jpg' ? readJpegDimensions(bytes) : readPngDimensions(bytes)) || { width: 400, height: 400 };
        cache[url] = {
          bytes,
          naturalWidth: dims.width,
          naturalHeight: dims.height,
          format: format || 'png'
        };
      } catch (e) {
        console.warn('Image non chargée:', url, e);
      }
    }));
    return cache;
  }

  // ====== BUILDERS DOCX ======
  function makeBuilders(d, imageCache) {
    const {
      Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
      AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
      HeadingLevel, LevelFormat, PageBreak
    } = d;

    const TEXT_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
    const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const ALL_BORDERS = { top: TEXT_BORDER, bottom: TEXT_BORDER, left: TEXT_BORDER, right: TEXT_BORDER };
    const NO_BORDERS  = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };
    const CELL_MARGINS = { top: 100, bottom: 100, left: 120, right: 120 };

    // Build a single empty answer "case" (2-row table: light blue header + white body)
    function buildAnswerCase() {
      return new Table({
        width: { size: 10500, type: WidthType.DXA },
        columnWidths: [10500],
        rows: [
          new TableRow({
            height: { value: 240, rule: "exact" },
            children: [new TableCell({
              width: { size: 10500, type: WidthType.DXA },
              shading: { fill: "D6E6F4", type: ShadingType.CLEAR, color: "auto" },
              borders: {
                top:    TEXT_BORDER,
                bottom: NO_BORDER,
                left:   TEXT_BORDER,
                right:  TEXT_BORDER,
              },
              children: [new Paragraph({ children: [new TextRun({ text: "" })] })]
            })]
          }),
          new TableRow({
            height: { value: 900, rule: "atLeast" },
            children: [new TableCell({
              width: { size: 10500, type: WidthType.DXA },
              borders: {
                top:    NO_BORDER,
                bottom: TEXT_BORDER,
                left:   TEXT_BORDER,
                right:  TEXT_BORDER,
              },
              margins: CELL_MARGINS,
              children: [new Paragraph({ children: [new TextRun({ text: "" })] })]
            })]
          })
        ]
      });
    }

    function buildArrow() {
      return new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: "↓", size: 36, color: "6A8DB5", font: "Arial" })],
        indent: { right: 200 }
      });
    }

    // ============== QUESTION BODY ==============
    // seqNumero : numéro séquentiel dans le cahier (1, 2, 3, …)
    function buildQuestionBody(q, seqNumero) {
      const elements = [];
      const num = seqNumero !== undefined ? seqNumero : q.numero;

      // Titre épuré : juste « Question N » avec trait d'accent burgundy en dessous
      // (le nom de l'opération intellectuelle n'apparaît plus dans le cahier de l'élève)
      elements.push(new Paragraph({
        children: [
          new TextRun({ text: "Question ", bold: true, size: 28 }),
          new TextRun({ text: `#${num}`, bold: true, size: 28, color: "8B3A2E" })
        ],
        spacing: { before: 0, after: 60 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 8, color: "8B3A2E", space: 4 }
        }
      }));
      elements.push(new Paragraph({ children: [new TextRun({ text: "" })], spacing: { after: 200 } }));

      // Prompt
      const body = q.questionBody;
      elements.push(new Paragraph({
        children: [
          new TextRun({ text: body.prompt })
        ],
        spacing: { after: 100 }
      }));

      // Bullets (optionnels)
      if (body.bullets && body.bullets.length > 0) {
        body.bullets.forEach(b => {
          elements.push(new Paragraph({
            children: [new TextRun({ text: b })],
            bullet: { level: 0 },
            indent: { left: 720 },
            spacing: { after: 40 }
          }));
        });
        elements.push(new Paragraph({ children: [new TextRun({ text: "" })] }));
      }

      // Instructions (optionnelles - utilisées surtout pour la causalité)
      if (body.instructions && body.instructions.parts) {
        elements.push(new Paragraph({
          children: body.instructions.parts.map(p => new TextRun({ text: p.text, bold: !!p.bold })),
          spacing: { after: 200 }
        }));
      }

      // Response space
      if (body.responseSpace) {
        if (body.responseSpace.type === 'lines') {
          // Lignes continues pour réponse textuelle écrite (approche table)
          const n = body.responseSpace.count || 6;
          const lineBorder = { style: BorderStyle.SINGLE, size: 4, color: "AAAAAA" };
          const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
          const lineRows = [];
          for (let i = 0; i < n; i++) {
            lineRows.push(new TableRow({
              height: { value: 420, rule: "atLeast" },
              children: [new TableCell({
                width: { size: 10500, type: WidthType.DXA },
                borders: { top: noBorder, bottom: lineBorder, left: noBorder, right: noBorder },
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                children: [new Paragraph({ children: [new TextRun({ text: "" })] })]
              })]
            }));
          }
          elements.push(new Table({
            width: { size: 10500, type: WidthType.DXA },
            columnWidths: [10500],
            rows: lineRows
          }));
        } else if (body.responseSpace.type === 'labeled-list') {
          // Liste d'items à étiqueter : tableau 2 colonnes (libellé | ligne d'écriture).
          // L'ancienne approche utilisait `tabStops` avec un `leader: "underscore"` —
          // Word le rend bien mais docx-preview ne supporte pas les leaders de tab,
          // ce qui faisait apparaître les espaces de réponse comme « manquants » dans
          // l'aperçu. Un tableau bordé fonctionne dans les deux moteurs.
          const items = body.responseSpace.items || [];
          const totalW = 10500;
          // Auto-dimensionner la colonne libellé pour éviter le retour à la ligne sur
          // les longs libellés (ex. « Conséquence de la sédentarisation (Document n°) »).
          // ~140 DXA/char + 400 DXA marge (calibré pour Word ET docx-preview, ce dernier
          // utilisant un rendu un peu plus large). Plancher à 3800, plafond pour garder
          // au moins 3500 DXA à la ligne de réponse.
          const maxChars = items.reduce((m, it) => Math.max(m, (it || '').length), 0);
          const labelColW = Math.max(3800, Math.min(totalW - 3500, maxChars * 140 + 400));
          const answerColW = totalW - labelColW;
          const lineBorder = { style: BorderStyle.SINGLE, size: 4, color: "AAAAAA" };
          const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
          const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
          const writingLineBorders = { top: noBorder, bottom: lineBorder, left: noBorder, right: noBorder };
          const llRows = items.map(item => new TableRow({
            height: { value: 480, rule: "atLeast" },
            children: [
              new TableCell({
                width: { size: labelColW, type: WidthType.DXA },
                borders: noBorders,
                verticalAlign: VerticalAlign.BOTTOM,
                margins: { top: 0, bottom: 60, left: 0, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: item, size: 22 })] })]
              }),
              new TableCell({
                width: { size: answerColW, type: WidthType.DXA },
                borders: writingLineBorders,
                verticalAlign: VerticalAlign.BOTTOM,
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                children: [new Paragraph({ children: [new TextRun({ text: "" })] })]
              })
            ]
          }));
          elements.push(new Table({
            width: { size: totalW, type: WidthType.DXA },
            columnWidths: [labelColW, answerColW],
            rows: llRows
          }));
        } else if (body.responseSpace.type === 'checkbox-table') {
          // Tableau de cases à cocher : lignes (items) × colonnes (catégories)
          const cols = body.responseSpace.columns || [];
          const rowItems = body.responseSpace.rows || [];
          const totalW = 10500;
          const firstColW = 4200;
          const otherColW = Math.floor((totalW - firstColW) / cols.length);
          const colWidths = [firstColW, ...cols.map(() => otherColW)];
          // En-tête
          const headerCells = [
            new TableCell({
              width: { size: firstColW, type: WidthType.DXA },
              borders: ALL_BORDERS,
              shading: { fill: "F5EFE2", type: ShadingType.CLEAR, color: "auto" },
              margins: CELL_MARGINS,
              children: [new Paragraph({ children: [new TextRun({ text: "" })] })]
            }),
            ...cols.map(c => new TableCell({
              width: { size: otherColW, type: WidthType.DXA },
              borders: ALL_BORDERS,
              shading: { fill: "F5EFE2", type: ShadingType.CLEAR, color: "auto" },
              margins: CELL_MARGINS,
              verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: c, bold: true, size: 20 })]
              })]
            }))
          ];
          const tableRows = [new TableRow({ children: headerCells, tableHeader: true })];
          rowItems.forEach(item => {
            const cells = [
              new TableCell({
                width: { size: firstColW, type: WidthType.DXA },
                borders: ALL_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                margins: CELL_MARGINS,
                children: [new Paragraph({ children: [new TextRun({ text: item, size: 22 })] })]
              }),
              ...cols.map(() => new TableCell({
                width: { size: otherColW, type: WidthType.DXA },
                borders: ALL_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                margins: CELL_MARGINS,
                children: [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  // Case à cocher rendue avec un caractère carré vide
                  children: [new TextRun({ text: "☐", size: 32 })]
                })]
              }))
            ];
            tableRows.push(new TableRow({
              height: { value: 500, rule: "atLeast" },
              children: cells
            }));
          });
          elements.push(new Table({
            width: { size: totalW, type: WidthType.DXA },
            columnWidths: colWidths,
            rows: tableRows
          }));
        } else if (body.responseSpace.type === 'chrono-ordering') {
          // Mise en ordre chronologique : N cases bordées séparées par des flèches « → ».
          // Format inspiré du gabarit pédagogique original : trois cercles connectés par
          // des flèches que l'élève remplit de gauche (le plus ancien) à droite (le plus récent).
          // Les `items` servent de petites étiquettes AU-DESSUS de chaque case (hors des encadrés).
          const items = body.responseSpace.items || [];
          const n = items.length;
          const totalW = 10500;
          const arrowW = 550;
          const boxW = Math.floor((totalW - (n - 1) * arrowW) / n);
          const widths = [];
          // Row 1: labels au-dessus (sans bordure)
          const labelRow = [];
          // Row 2: cases vides + flèches
          const boxRow = [];
          items.forEach((label, i) => {
            widths.push(boxW);
            labelRow.push(new TableCell({
              width: { size: boxW, type: WidthType.DXA },
              borders: NO_BORDERS,
              verticalAlign: VerticalAlign.BOTTOM,
              margins: { top: 0, bottom: 60, left: 0, right: 0 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: label, size: 18, italics: true, color: "6E685C" })]
              })]
            }));
            boxRow.push(new TableCell({
              width: { size: boxW, type: WidthType.DXA },
              borders: ALL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 100, bottom: 100, left: 80, right: 80 },
              children: [
                new Paragraph({ children: [new TextRun({ text: "", size: 24 })] }),
                new Paragraph({ children: [new TextRun({ text: "", size: 24 })] })
              ]
            }));
            if (i < n - 1) {
              widths.push(arrowW);
              // Cellule vide alignée avec la flèche dans la 2e row
              labelRow.push(new TableCell({
                width: { size: arrowW, type: WidthType.DXA },
                borders: NO_BORDERS,
                children: [new Paragraph({ children: [new TextRun({ text: "" })] })]
              }));
              boxRow.push(new TableCell({
                width: { size: arrowW, type: WidthType.DXA },
                borders: NO_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                children: [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: "→", size: 40, bold: true })]
                })]
              }));
            }
          });
          elements.push(new Table({
            width: { size: totalW, type: WidthType.DXA },
            columnWidths: widths,
            rows: [
              new TableRow({ children: labelRow }),
              new TableRow({ height: { value: 1000, rule: "atLeast" }, children: boxRow })
            ]
          }));
        } else if (body.responseSpace.type === 'before-after-axis') {
          // Axe chronologique à 3 boîtes : Antériorité | événement pivot | Postériorité.
          // Les boîtes latérales sont vides dans le cahier (l'élève y inscrit les documents
          // qui surviennent avant/après l'événement). La boîte centrale affiche le pivot.
          const rs = body.responseSpace;
          const beforeLabel = rs.beforeLabel || 'Antériorité (Avant)';
          const afterLabel  = rs.afterLabel  || 'Postériorité (Après)';
          const pivot       = rs.pivot       || '';
          const totalW = 10500;
          const arrowW = 450;
          const sideW = Math.floor((totalW - 2 * arrowW) * 0.32);
          const centerW = totalW - 2 * sideW - 2 * arrowW;
          const widths = [sideW, arrowW, centerW, arrowW, sideW];
          const baCells = [
            // Boîte 1 : Antériorité (avec libellé en haut, espace vide en dessous)
            new TableCell({
              width: { size: sideW, type: WidthType.DXA },
              borders: ALL_BORDERS,
              verticalAlign: VerticalAlign.TOP,
              margins: { top: 100, bottom: 100, left: 80, right: 80 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 80 },
                  children: [new TextRun({ text: beforeLabel, bold: true, size: 20, color: "6E685C" })]
                }),
                new Paragraph({ children: [new TextRun({ text: "", size: 24 })] }),
                new Paragraph({ children: [new TextRun({ text: "", size: 24 })] })
              ]
            }),
            // Flèche ← du centre vers la gauche
            new TableCell({
              width: { size: arrowW, type: WidthType.DXA },
              borders: NO_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "←", size: 36, bold: true })] })]
            }),
            // Boîte centrale : événement pivot (pré-rempli, lecture seule)
            new TableCell({
              width: { size: centerW, type: WidthType.DXA },
              borders: ALL_BORDERS,
              shading: { fill: "F5EFE2", type: ShadingType.CLEAR, color: "auto" },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 120, bottom: 120, left: 100, right: 100 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: pivot, bold: true, size: 20 })]
              })]
            }),
            // Flèche → du centre vers la droite
            new TableCell({
              width: { size: arrowW, type: WidthType.DXA },
              borders: NO_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "→", size: 36, bold: true })] })]
            }),
            // Boîte 3 : Postériorité (avec libellé en haut, espace vide en dessous)
            new TableCell({
              width: { size: sideW, type: WidthType.DXA },
              borders: ALL_BORDERS,
              verticalAlign: VerticalAlign.TOP,
              margins: { top: 100, bottom: 100, left: 80, right: 80 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 80 },
                  children: [new TextRun({ text: afterLabel, bold: true, size: 20, color: "6E685C" })]
                }),
                new Paragraph({ children: [new TextRun({ text: "", size: 24 })] }),
                new Paragraph({ children: [new TextRun({ text: "", size: 24 })] })
              ]
            })
          ];
          elements.push(new Table({
            width: { size: totalW, type: WidthType.DXA },
            columnWidths: widths,
            rows: [new TableRow({ height: { value: 1400, rule: "atLeast" }, children: baCells })]
          }));
        } else if (body.responseSpace.type === 'cases-causalite') {
          // Conservé pour rétro-compatibilité — cases bleutées avec flèches
          for (let i = 0; i < body.responseSpace.count; i++) {
            elements.push(buildAnswerCase());
            if (i < body.responseSpace.count - 1) {
              elements.push(buildArrow());
            }
          }
        }
      }

      return elements;
    }

    // ============== RÉGLETTE ==============
    function buildReglette(r) {
      // Type "simple" : tableau matriciel à 2 rangées (en-tête points / conditions)
      if (r.type === 'simple') {
        return buildSimpleReglette(r);
      }
      // Sinon, type "complex" par défaut (utilisé pour les rubriques de causalité)
      return buildComplexReglette(r);
    }

    function buildSimpleReglette(r) {
      const levels = r.levels || [];
      const totalW = 10500;
      const labelW = 2000;
      const levelW = Math.floor((totalW - labelW) / Math.max(levels.length, 1));
      const colWidths = [labelW, ...levels.map(() => levelW)];

      // Row 1 : label opération (rowspan 2) + en-tête points
      const row1Cells = [
        new TableCell({
          width: { size: labelW, type: WidthType.DXA },
          rowSpan: 2,
          borders: ALL_BORDERS,
          verticalAlign: VerticalAlign.CENTER,
          margins: CELL_MARGINS,
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: r.opLabel, bold: true, size: 20 })]
          })]
        }),
        ...levels.map(lvl => new TableCell({
          width: { size: levelW, type: WidthType.DXA },
          borders: ALL_BORDERS,
          shading: { fill: "F5EFE2", type: ShadingType.CLEAR, color: "auto" },
          verticalAlign: VerticalAlign.CENTER,
          margins: CELL_MARGINS,
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: lvl.points, bold: true, size: 20 })]
          })]
        }))
      ];

      // Row 2 : conditions (la 1re cellule étant merged depuis la row1)
      // Le « (N sur M) » est isolé sur sa propre ligne sous le texte qualitatif
      const row2Cells = levels.map(lvl => {
        const countMatch = lvl.condition.match(/\s*(\([^)]*sur[^)]*\))\s*\.?\s*$/i);
        const mainText = countMatch
          ? lvl.condition.slice(0, countMatch.index).replace(/\s+$/, '')
          : lvl.condition;
        const countText = countMatch ? countMatch[1] : null;
        const paragraphs = [new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: countText ? 40 : 0 },
          children: [new TextRun({ text: mainText, size: 18 })]
        })];
        if (countText) {
          paragraphs.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0 },
            children: [new TextRun({ text: countText, size: 18, color: "6E685C", italics: true })]
          }));
        }
        return new TableCell({
          width: { size: levelW, type: WidthType.DXA },
          borders: ALL_BORDERS,
          verticalAlign: VerticalAlign.CENTER,
          margins: CELL_MARGINS,
          children: paragraphs
        });
      });

      return [new Table({
        width: { size: totalW, type: WidthType.DXA },
        columnWidths: colWidths,
        rows: [
          new TableRow({ children: row1Cells }),
          new TableRow({ children: row2Cells })
        ]
      })];
    }

    function buildComplexReglette(r) {
      // 4-column rubric table: opName (merged vertical) | precise | condition | points
      // Build rows: track precise cells to span across when null
      const rows = r.rows;
      const tableRows = [];

      // We'll need to compute vertical merges later. For simplicity, render flat with explicit merge data.
      // python-docx style merges are easier; in docx-js use rowSpan.

      // Group consecutive rows where precise is "continuation" (precise=null means continuation)
      // First pass: assign rowspan to first row of each precise group
      const merged = [];
      let i = 0;
      while (i < rows.length) {
        let span = 1;
        let j = i + 1;
        while (j < rows.length && rows[j].precise === null) { span++; j++; }
        merged.push({ startIdx: i, span, precise: rows[i].precise });
        i = j;
      }

      // Op label cell merged across ALL rows
      const opSpan = rows.length;

      // Build all table rows
      for (let r_i = 0; r_i < rows.length; r_i++) {
        const row = rows[r_i];
        const cells = [];

        // Col 1: operation label, spans all rows (only on first row)
        if (r_i === 0) {
          cells.push(new TableCell({
            width: { size: 1800, type: WidthType.DXA },
            rowSpan: opSpan,
            borders: ALL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            margins: CELL_MARGINS,
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: r.opLabel, bold: true, size: 20 })]
            })]
          }));
        }

        // Col 2: precise label, with rowSpan according to merged group
        const groupHere = merged.find(g => g.startIdx === r_i);
        if (groupHere) {
          // Last row of "L'élève précise un seul élément ou n'en précise pas." spans col 2+3
          const isLast = groupHere.startIdx === rows.length - 1 && row.condition === null;
          cells.push(new TableCell({
            width: { size: isLast ? 6000 : 3000, type: WidthType.DXA },
            rowSpan: groupHere.span,
            borders: ALL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            margins: CELL_MARGINS,
            columnSpan: isLast ? 2 : 1,
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: groupHere.precise, size: 20 })]
            })]
          }));
        }

        // Col 3: condition
        if (row.condition !== null) {
          cells.push(new TableCell({
            width: { size: 3000, type: WidthType.DXA },
            borders: ALL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            margins: CELL_MARGINS,
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: row.condition, size: 20 })]
            })]
          }));
        }

        // Col 4: points
        cells.push(new TableCell({
          width: { size: 1200, type: WidthType.DXA },
          borders: ALL_BORDERS,
          verticalAlign: VerticalAlign.CENTER,
          margins: CELL_MARGINS,
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: row.points, size: 20 })]
          })]
        }));

        tableRows.push(new TableRow({ children: cells }));
      }

      return [new Table({
        width: { size: 10500, type: WidthType.DXA },
        columnWidths: [1800, 3000, 3000, 1200],
        rows: tableRows
      })];
    }

    // ============== DOCUMENT ==============
    // outerWidth : largeur du conteneur en DXA (10500 par défaut = pleine largeur)
    // Si outerWidth < 6000, on bascule en mode « étroit » (image au-dessus du texte, polices plus petites)
    function buildDocument(d_doc, outerWidth) {
      outerWidth = outerWidth || 10500;
      const isNarrow = outerWidth < 6000;
      const innerW = outerWidth - 200; // un peu de marge interne pour le cell padding
      const fontSize = isNarrow ? 18 : 20;
      const sourceFontSize = isNarrow ? 12 : 14;
      const elements = [];

      const titleP = new Paragraph({
        children: [new TextRun({ text: d_doc.title, bold: true, color: "1F77B4", size: isNarrow ? 20 : 22 })],
        spacing: { after: 80 }
      });
      const sourcesPs = d_doc.sources.map(s =>
        new Paragraph({ children: [new TextRun({ text: s, italics: true, size: sourceFontSize })], spacing: { after: 20, line: 180, lineRule: 'exact' } })
      );

      // Aspect ratio réel de l'image (si présente)
      function calcImageDims(imgInfo, targetWidthCm) {
        if (!imgInfo) return { widthPx: Math.round(targetWidthCm * 28.35), heightPx: Math.round(targetWidthCm * 28.35) };
        const widthPx = Math.round(targetWidthCm * 28.35);
        const ratio = imgInfo.naturalHeight / imgInfo.naturalWidth;
        return { widthPx, heightPx: Math.round(widthPx * ratio) };
      }

      if (d_doc.layout === 'text-image') {
        const imgInfo = imageCache[d_doc.imageUrl];
        const targetCm = d_doc.imageWidthCm || 3.5;
        const dims = calcImageDims(imgInfo, targetCm);
        const imgChildren = imgInfo
          ? [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new ImageRun({ data: imgInfo.bytes, transformation: { width: dims.widthPx, height: dims.heightPx }, type: imgInfo.format || 'png' })]
            })]
          : [new Paragraph({ children: [new TextRun({ text: "[image]" })] })];

        if (isNarrow) {
          // Mode étroit : image au-dessus, texte en-dessous (1 colonne)
          const cellChildren = [titleP, ...imgChildren, new Paragraph({
            children: [new TextRun({ text: d_doc.text, size: fontSize })],
            spacing: { before: 80, after: 80 }
          }), ...sourcesPs];
          elements.push(new Table({
            width: { size: innerW, type: WidthType.DXA },
            columnWidths: [innerW],
            rows: [new TableRow({
              cantSplit: true,
              children: [new TableCell({
                width: { size: innerW, type: WidthType.DXA },
                borders: ALL_BORDERS, margins: CELL_MARGINS,
                children: cellChildren
              })]
            })]
          }));
        } else {
          // Mode large : texte à gauche (70%), image à droite (30%)
          const textW = Math.round(innerW * 0.62);
          const imgW = innerW - textW;
          const textCellChildren = [titleP, new Paragraph({
            children: [new TextRun({ text: d_doc.text, size: fontSize })],
            spacing: { after: 120 }
          }), ...sourcesPs];
          elements.push(new Table({
            width: { size: innerW, type: WidthType.DXA },
            columnWidths: [textW, imgW],
            rows: [new TableRow({
              cantSplit: true,
              children: [
                new TableCell({
                  width: { size: textW, type: WidthType.DXA },
                  borders: ALL_BORDERS, verticalAlign: VerticalAlign.TOP, margins: CELL_MARGINS,
                  children: textCellChildren
                }),
                new TableCell({
                  width: { size: imgW, type: WidthType.DXA },
                  borders: ALL_BORDERS, verticalAlign: VerticalAlign.CENTER, margins: CELL_MARGINS,
                  children: imgChildren
                })
              ]
            })]
          }));
        }
      } else if (d_doc.layout === 'image-only') {
        // Encadré image-only :
        //  - En mode appairé (étroit) : la boîte remplit toute la cellule pour éviter
        //    un grand espace entre les deux documents côte à côte.
        //  - En mode seul (large) : la boîte reste à la taille de l'image, alignée à gauche.
        const imgInfo = imageCache[d_doc.imageUrl];
        let targetCm = d_doc.imageWidthCm || 7;
        // En mode étroit, limiter la taille de l'image à ce qui rentre dans la cellule
        const maxCmInCell = isNarrow ? (innerW / 567) - 1 : 13;
        targetCm = Math.min(Math.max(targetCm, 3), maxCmInCell);
        const dims = calcImageDims(imgInfo, targetCm);

        const tableWidthDxa = isNarrow
          ? innerW
          : Math.min(Math.round(targetCm * 567) + 480, innerW);

        const cellChildren = [titleP];
        if (imgInfo) {
          cellChildren.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({ data: imgInfo.bytes, transformation: { width: dims.widthPx, height: dims.heightPx }, type: imgInfo.format || 'png' })],
            spacing: { after: 80 }
          }));
        }
        cellChildren.push(...sourcesPs);

        elements.push(new Table({
          width: { size: tableWidthDxa, type: WidthType.DXA },
          columnWidths: [tableWidthDxa],
          rows: [new TableRow({
            cantSplit: true,
            children: [new TableCell({
              width: { size: tableWidthDxa, type: WidthType.DXA },
              borders: ALL_BORDERS,
              margins: CELL_MARGINS,
              children: cellChildren
            })]
          })]
        }));
      } else { // text-only
        const cellChildren = [titleP];
        cellChildren.push(new Paragraph({
          children: [new TextRun({ text: d_doc.text, size: fontSize })],
          spacing: { after: 120 }
        }));
        cellChildren.push(...sourcesPs);

        elements.push(new Table({
          width: { size: innerW, type: WidthType.DXA },
          columnWidths: [innerW],
          rows: [new TableRow({
            cantSplit: true,
            children: [new TableCell({
              width: { size: innerW, type: WidthType.DXA },
              borders: ALL_BORDERS,
              margins: CELL_MARGINS,
              children: cellChildren
            })]
          })]
        }));
      }

      return elements;
    }

    // ============== DOCUMENTS APPAIRÉS (côte à côte) ==============
    // Deux documents étroits dans une seule rangée à 2 colonnes.
    function buildPairedDocuments(d1, d2) {
      const outerW = 10500;
      const cellW = Math.floor((outerW - 200) / 2); // ~5150 DXA chacun, ~9.1 cm
      const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
      const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

      const inner1 = buildDocument(d1, cellW);
      const inner2 = buildDocument(d2, cellW);

      return new Table({
        width: { size: outerW, type: WidthType.DXA },
        columnWidths: [cellW, 200, cellW],
        rows: [new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: cellW, type: WidthType.DXA },
              borders: noBorders,
              verticalAlign: VerticalAlign.TOP,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: inner1
            }),
            new TableCell({
              width: { size: 200, type: WidthType.DXA },
              borders: noBorders,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: [new Paragraph({ children: [new TextRun({ text: "" })] })]
            }),
            new TableCell({
              width: { size: cellW, type: WidthType.DXA },
              borders: noBorders,
              verticalAlign: VerticalAlign.TOP,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: inner2
            })
          ]
        })]
      });
    }

    return { buildQuestionBody, buildReglette, buildDocument, buildPairedDocuments };
  }

  // ====== UTILS ======
  function showLoading(msg) {
    el.loadingMsg.textContent = msg || 'Chargement…';
    el.loading.hidden = false;
  }
  function hideLoading() { el.loading.hidden = true; }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // ====== BOOT ======
  // Avant init(), on tente de charger les questions éditées via le CMS
  // (assets/data/questions.json). Si le fichier est absent ou illisible
  // (ex. ouverture en file://), on retombe proprement sur les données
  // héritées de data.js — l'app fonctionne exactement comme avant.
  async function loadCMSQuestions() {
    if (typeof window.QuizCMS === 'undefined') return;       // adaptateur non chargé
    if (typeof DATA === 'undefined' || !DATA || !Array.isArray(DATA.questions)) return; // data.js absent / vide
    try {
      const res = await fetch('assets/data/questions.json', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.questions || []);
      if (!list.length) return;
      const indexById = new Map(DATA.questions.map((q, i) => [q.id, i]));
      let remplacees = 0, ajoutees = 0;
      list.forEach((cms) => {
        const rq = window.QuizCMS.toRuntime(cms);
        if (indexById.has(rq.id)) { DATA.questions[indexById.get(rq.id)] = rq; remplacees++; }
        else { DATA.questions.push(rq); indexById.set(rq.id, DATA.questions.length - 1); ajoutees++; }
      });
      console.info(`[CMS] questions.json : ${remplacees} remplacée(s), ${ajoutees} ajoutée(s).`);
    } catch (e) {
      console.warn('[CMS] questions.json non chargé — données héritées utilisées.', e && e.message);
    }
  }

  function boot() { loadCMSQuestions().then(init).catch(init); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
