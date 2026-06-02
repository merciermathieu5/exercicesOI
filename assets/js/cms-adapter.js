/* ============================================================
   HEC · Adaptateur CMS <-> runtime
   ------------------------------------------------------------
   La forme "CMS" est plate et déclarative : c'est ce que Sveltia
   CMS écrit dans assets/data/questions.json. La forme "runtime"
   est celle qu'attend app.js (questionBody.responseSpace = objet,
   instructions = { parts:[...] }, corrige polymorphe, etc.).

   - toRuntime(cms)  : utilisé par le navigateur (app.js) au chargement
   - toCMS(runtime)  : utilisé une seule fois par le script de migration
   Les deux sont l'inverse exact l'un de l'autre — le test d'aller-retour
   (toRuntime(toCMS(q)) === q) le prouve sur l'échantillon.

   Fonctionne dans le navigateur (window.QuizCMS) et dans Node
   (module.exports), sans aucune dépendance.
   ============================================================ */
(function (root) {
  'use strict';

  // ---------- utilitaires ----------
  function isArray(x) { return Array.isArray(x); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

  // ---------- corrigé : runtime -> CMS ----------
  function corrigeToCMS(c) {
    if (typeof c === 'string') {
      return [{ kind: 'texte', valeur: c }];
    }
    if (isArray(c)) {
      // tableau de tableaux de booléens => checkbox-table
      if (c.length > 0 && isArray(c[0])) {
        return [{ kind: 'cases', lignes: c.map(function (row) {
          return { cochees: row.map(function (b) { return { coche: !!b }; }) };
        }) }];
      }
      // sinon : liste de lettres / positions
      return [{ kind: 'lettres', valeurs: c.slice() }];
    }
    if (c && typeof c === 'object') {
      return [{ kind: 'avant_apres',
                avant: (c.before || []).slice(),
                apres: (c.after || []).slice() }];
    }
    return [{ kind: 'texte', valeur: '' }];
  }

  // ---------- corrigé : CMS -> runtime ----------
  function corrigeToRuntime(arr) {
    var c = (arr && arr[0]) || { kind: 'texte', valeur: '' };
    switch (c.kind) {
      case 'texte':   return c.valeur || '';
      case 'lettres': return (c.valeurs || []).slice();
      case 'cases':   return (c.lignes || []).map(function (l) {
                        return (l.cochees || []).map(function (x) { return !!x.coche; });
                      });
      case 'avant_apres': return { before: (c.avant || []).slice(),
                                   after:  (c.apres || []).slice() };
      default: return '';
    }
  }

  // ---------- instructions : runtime { parts:[{text,bold?}] } <-> CMS [{text,bold}] ----------
  function instructionsToCMS(instr) {
    if (!instr || !isArray(instr.parts)) return [];
    return instr.parts.map(function (p) {
      return { text: p.text, bold: !!p.bold };
    });
  }
  function instructionsToRuntime(list) {
    if (!isArray(list) || list.length === 0) return undefined;
    return { parts: list.map(function (p) {
      var part = { text: p.text || '' };
      if (p.bold) part.bold = true;     // on n'écrit bold que s'il est vrai (fidèle au runtime)
      return part;
    }) };
  }

  // ---------- réglettes ----------
  function regletteToCMS(r) {
    var out = { type: r.type, id: r.id, label: r.label,
                opLabel: r.opLabel, maxPoints: r.maxPoints };
    if (r.type === 'complex') {
      out.rows = (r.rows || []).map(function (row) {
        return { precise: row.precise == null ? '' : row.precise,
                 condition: row.condition == null ? '' : row.condition,
                 points: row.points };
      });
    } else {
      out.levels = (r.levels || []).map(function (lv) {
        return { points: lv.points, condition: lv.condition };
      });
    }
    return out;
  }
  function regletteToRuntime(r) {
    var out = { id: r.id, label: r.label, type: r.type,
                opLabel: r.opLabel, maxPoints: r.maxPoints };
    if (r.type === 'complex') {
      out.rows = (r.rows || []).map(function (row) {
        return { precise: row.precise === '' ? null : row.precise,
                 condition: row.condition === '' ? null : row.condition,
                 points: row.points };
      });
    } else {
      out.levels = (r.levels || []).map(function (lv) {
        return { points: lv.points, condition: lv.condition };
      });
    }
    return out;
  }

  // ---------- documents ----------
  var DOC_FIELDS = ['id', 'title', 'layout', 'text', 'imageUrl', 'imageWidthCm', 'sources'];
  function docToCMS(d) {
    var out = {};
    DOC_FIELDS.forEach(function (k) { if (d[k] !== undefined) out[k] = clone(d[k]); });
    return out;
  }
  function docToRuntime(d) {
    var out = { id: d.id, title: d.title, layout: d.layout };
    if (d.text !== undefined && d.text !== '') out.text = d.text;
    if (d.imageUrl !== undefined && d.imageUrl !== '') out.imageUrl = d.imageUrl;
    if (d.imageWidthCm !== undefined && d.imageWidthCm !== null && d.imageWidthCm !== '')
      out.imageWidthCm = d.imageWidthCm;
    if (isArray(d.sources)) out.sources = d.sources.slice();
    return out;
  }

  // ---------- responseSpace (liste de 1 côté CMS, objet côté runtime) ----------
  function responseSpaceToCMS(rs) { return rs ? [clone(rs)] : []; }
  function responseSpaceToRuntime(arr) { return (arr && arr[0]) ? clone(arr[0]) : undefined; }

  // ============ QUESTION : runtime -> CMS ============
  function toCMS(q) {
    var qb = q.questionBody || {};
    var cms = {
      id: q.id,
      operation: q.operation,
      numero: q.numero,
      niveau: q.niveau,
      realite_sociale_id: q.realite_sociale_id,
      questionBody: {
        prompt: qb.prompt || '',
        bullets: isArray(qb.bullets) ? qb.bullets.slice() : [],
        instructions: instructionsToCMS(qb.instructions),
        responseSpace: responseSpaceToCMS(qb.responseSpace)
      },
      reglettes: (q.reglettes || []).map(regletteToCMS),
      documents: (q.documents || []).map(docToCMS),
      corrige: corrigeToCMS(q.corrige)
    };
    return cms;
  }

  // ============ QUESTION : CMS -> runtime ============
  function toRuntime(c) {
    var cqb = c.questionBody || {};
    var qb = { prompt: cqb.prompt || '' };
    if (isArray(cqb.bullets) && cqb.bullets.length) qb.bullets = cqb.bullets.slice();
    var instr = instructionsToRuntime(cqb.instructions);
    if (instr) qb.instructions = instr;
    qb.responseSpace = responseSpaceToRuntime(cqb.responseSpace);

    return {
      id: c.id,
      operation: c.operation,
      numero: c.numero,
      niveau: c.niveau,
      realite_sociale_id: c.realite_sociale_id,
      questionBody: qb,
      reglettes: (c.reglettes || []).map(regletteToRuntime),
      documents: (c.documents || []).map(docToRuntime),
      corrige: corrigeToRuntime(c.corrige)
    };
  }

  var API = { toCMS: toCMS, toRuntime: toRuntime };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.QuizCMS = API;

})(typeof window !== 'undefined' ? window : this);
