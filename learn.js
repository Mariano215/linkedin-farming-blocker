// Turns cards you marked by hand into candidate rules.
//
// Pure functions, no DOM, no storage. Given marked samples it returns phrases that recur
// across them, which you then approve or reject in the options page. Nothing here writes
// a rule on its own: a generated filter you never read is how a tool quietly starts
// hiding things you wanted.
(function (root) {
  'use strict';

  const MIN_DOCS = 2; // a phrase must recur across marks, one example proves nothing
  const MAX_SUGGESTIONS = 20;
  const NGRAM_MIN = 2;
  const NGRAM_MAX = 5;

  const STOP = new Set(
    ('a an the and or but if then than that this these those of in on at to for with from by as is are was were be been ' +
      'am i you he she it we they me him her us them my your our their his its will would can could should may might must ' +
      'do does did done have has had not no yes so up out about into over after before more most other some such only own ' +
      'same too very just now here there when where why how all any both each few nor own s t don now new job jobs role ' +
      'position hiring apply candidate candidates work working experience years year ago month months week weeks day days ' +
      'ltd inc llc pvt company team please thanks thank you').split(' ')
  );

  // Deny-list for RULE GENERATION only. Nothing here filters posts: it stops the learner
  // from proposing a rule that keys on who someone is or where they are, rather than on
  // what the post does. A phrase caught here is reported back with its reason so the
  // decision is visible instead of silent.
  //
  // Blocking an individual poster is a separate, deliberate action and is not affected.
  const PROTECTED = [
    {
      // country and region names, plus the common demonym forms
      re: /\b(afghan\w*|africa\w*|albania\w*|algeria\w*|america\w*|arab\w*|argentin\w*|asia\w*|australia\w*|austria\w*|banglades\w*|belarus\w*|belgi\w*|bolivia\w*|bosnia\w*|brazil\w*|britain|british|bulgaria\w*|cambodia\w*|cameroon\w*|canad\w*|caribbean|chile\w*|chin\w*|colombia\w*|congo\w*|croatia\w*|cuba\w*|czech\w*|dane|danish|denmark|dominican|dutch|ecuador\w*|egypt\w*|england|english|eritrea\w*|estonia\w*|ethiopia\w*|europe\w*|filipin\w*|finland|finnish|france|french|german\w*|ghana\w*|greece|greek|guatemala\w*|haiti\w*|hondura\w*|hungar\w*|iceland\w*|india|indian|indians|indonesia\w*|iran\w*|iraq\w*|ireland|irish|israel\w*|ital\w*|jamaica\w*|japan\w*|jordan\w*|kazakh\w*|kenya\w*|korea\w*|kuwait\w*|kyrgyz\w*|laos|latvia\w*|lebano\w*|liberia\w*|libya\w*|lithuania\w*|malaysia\w*|mexic\w*|middle east\w*|moldova\w*|mongolia\w*|morocc\w*|myanmar|nepal\w*|netherlands|new zealand\w*|nicaragua\w*|nigeria\w*|norway|norwegian|pakistan\w*|palestin\w*|panama\w*|paraguay\w*|peru\w*|philippine\w*|poland|polish|portug\w*|puerto ric\w*|qatar\w*|romania\w*|russia\w*|rwanda\w*|salvador\w*|saudi\w*|scotland|scottish|senegal\w*|serbia\w*|singapor\w*|slovak\w*|sloven\w*|somal\w*|south africa\w*|spain|spanish|sri lanka\w*|sudan\w*|sweden|swedish|swiss|switzerland|syria\w*|taiwan\w*|tanzania\w*|thai\w*|tunisia\w*|turk\w*|ukrain\w*|uruguay\w*|uzbek\w*|venezuela\w*|vietnam\w*|wales|welsh|yemen\w*|zimbabwe\w*)\b/,
      reason: 'names a country or nationality'
    },
    {
      // cities and locales that stand in for the same thing
      re: /\b(bangalore|bengaluru|chennai|delhi|gurgaon|gurugram|hyderabad|karachi|lahore|islamabad|mumbai|noida|pune|kolkata|dhaka|manila|cebu|jakarta|hanoi|lagos|nairobi|cairo|dubai)\b/,
      reason: 'names a city used as a stand-in for nationality'
    },
    {
      // location-of-person framings, whatever place follows
      re: /\b(offshore|onshore|off-shore|based (in|out of)|located in|working from|residing in|native|expat|immigrant|visa status|citizenship|green card holder|nationality|ethnic\w*|race|religio\w*|caste|accent|non-native|first language|mother tongue)\b/,
      reason: 'keys on where a person is or who they are, not on what the post does'
    },
    {
      // name-shaped phrases are a proxy for ethnicity, and belong in poster blocking
      re: /\b(surname|last name|full name)\b/,
      reason: 'targets names, which is a proxy for ethnicity, use poster blocking instead'
    }
  ];

  function protectedBy(phrase) {
    for (const p of PROTECTED) if (p.re.test(phrase)) return p.reason;
    return null;
  }

  function words(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9$₹+\s'-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  function phrasesOf(text) {
    const w = words(text);
    const out = new Set();
    for (let n = NGRAM_MIN; n <= NGRAM_MAX; n++) {
      for (let i = 0; i + n <= w.length; i++) {
        const slice = w.slice(i, i + n);
        // A keyphrase should not begin or end on a stopword, and must carry some content.
        if (STOP.has(slice[0]) || STOP.has(slice[n - 1])) continue;
        if (slice.every((x) => STOP.has(x))) continue;
        if (slice.some((x) => x.length > 24)) continue;
        out.add(slice.join(' '));
      }
    }
    return out;
  }

  // Returns { candidates, blocked, posters }.
  // candidates: phrases recurring across marks that you can turn into rules.
  // blocked:    phrases withheld, each with the reason, so the call is visible.
  // posters:    who you marked, for blocking an individual outright.
  function suggest(marked, options) {
    const opts = options || {};
    const known = (opts.phrases || []).map((p) => String(p).toLowerCase());
    const docFreq = new Map();

    for (const m of marked || []) {
      const text = [m.title, m.company, m.text].filter(Boolean).join(' ');
      for (const phrase of phrasesOf(text)) docFreq.set(phrase, (docFreq.get(phrase) || 0) + 1);
    }

    const candidates = [];
    const blocked = [];
    for (const [phrase, count] of docFreq) {
      if (count < MIN_DOCS) continue;
      if (known.some((k) => phrase.includes(k) || k.includes(phrase))) continue;
      const reason = protectedBy(phrase);
      if (reason) blocked.push({ phrase, count, reason });
      else candidates.push({ phrase, count });
    }

    // Most recurrent first, then longer phrases, which are more specific and so safer.
    const rank = (a, b) => b.count - a.count || b.phrase.length - a.phrase.length;
    candidates.sort(rank);
    blocked.sort(rank);

    // Drop a phrase wholly contained in a better-ranked one, otherwise the list fills up
    // with every sub-phrase of the same finding.
    const kept = [];
    for (const c of candidates) {
      if (!kept.some((k) => k.phrase.includes(c.phrase))) kept.push(c);
    }

    const posters = new Map();
    for (const m of marked || []) {
      const key = m.posterUrl || m.posterName;
      if (!key) continue;
      const at = posters.get(key) || { key, name: m.posterName || key, count: 0 };
      at.count++;
      posters.set(key, at);
    }

    return {
      candidates: kept.slice(0, MAX_SUGGESTIONS),
      blocked: blocked.slice(0, MAX_SUGGESTIONS),
      posters: Array.from(posters.values()).sort((a, b) => b.count - a.count)
    };
  }

  const api = { suggest, protectedBy, phrasesOf, MIN_DOCS };
  root.LFBLearn = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
