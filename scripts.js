/* ==========================================================================
   Convert Money · DevClub
   scripts.js — lógica do conversor (vanilla JS, sem dependências)
   --------------------------------------------------------------------------
   1.  Configuração e catálogo de moedas
   2.  Utilidades (DOM, números, texto, tempo)
   3.  Persistência e cache
   4.  Serviço de cotações (AwesomeAPI + fallbacks)
   5.  Estado da aplicação
   6.  Renderização
   7.  Seletor de moeda acessível (combobox)
   8.  Conversão e histórico
   9.  Atalhos, tema, compartilhamento e rede
   10. Inicialização
   ========================================================================== */
(function () {
  'use strict';

  /* ==========================================================================
     1. CONFIGURAÇÃO E CATÁLOGO DE MOEDAS
     ========================================================================== */
  const APP_VERSION = 'v2.0';
  const LOCALE = 'pt-BR';
  const STORE_PREFIX = 'devclub:cm:';

  const RATE_TTL = 10 * 60 * 1000;        // cotação do par selecionado
  const MARKET_TTL = 10 * 60 * 1000;      // painel "Mercado agora"
  const SERIES_TTL = 6 * 60 * 60 * 1000;  // série histórica
  const FETCH_TIMEOUT = 9000;
  const HISTORY_MAX = 12;
  const SERIES_DAYS = 30;
  const DEBOUNCE_MS = 160;

  const CURRENCIES = {
    BRL: { code: 'BRL', name: 'Real brasileiro', short: 'Real', symbol: 'R$', flag: 'assets/flags/br.svg', kind: 'fiat' },
    USD: { code: 'USD', name: 'Dólar americano', short: 'Dólar', symbol: 'US$', flag: 'assets/flags/us.svg', kind: 'fiat' },
    EUR: { code: 'EUR', name: 'Euro', short: 'Euro', symbol: '€', flag: 'assets/flags/eu.svg', kind: 'fiat' },
    GBP: { code: 'GBP', name: 'Libra esterlina', short: 'Libra', symbol: '£', flag: 'assets/flags/gb.svg', kind: 'fiat' },
    BTC: { code: 'BTC', name: 'Bitcoin', short: 'Bitcoin', symbol: '₿', flag: 'assets/flags/btc.svg', kind: 'crypto' }
  };

  const CODES = Object.keys(CURRENCIES);

  /* Valores de contingência: quantos reais vale 1 unidade da moeda.
     Usados somente se as duas APIs estiverem inacessíveis. */
  const FALLBACK_BRL_PER = { BRL: 1, USD: 5.0627, EUR: 5.6812, GBP: 6.7215, BTC: 412856 };
  const FALLBACK_DATE = Date.parse('2026-10-16T18:01:00-03:00');

  /* A AwesomeAPI publica Bitcoin apenas como moeda de origem e só contra estas moedas. */
  const BTC_QUOTES = { BRL: true, USD: true, EUR: true };

  /* A AwesomeAPI publica Bitcoin apenas como moeda de origem (BTC-BRL, BTC-USD…).
     Para pares do tipo "algo-BTC" buscamos o par invertido e invertemos a cotação;
     combinações sem par publicado caem no cruzamento via real. */
  function apiPair(from, to) {
    if (from === 'BTC') {
      return BTC_QUOTES[to] ? { pair: 'BTC-' + to, invert: false } : { pair: null, invert: false };
    }
    if (to === 'BTC') {
      return BTC_QUOTES[from] ? { pair: 'BTC-' + from, invert: true } : { pair: null, invert: true };
    }
    return { pair: from + '-' + to, invert: false };
  }

  const APIS = {
    pair: (pair) => 'https://economia.awesomeapi.com.br/json/last/' + pair,
    daily: (pair, days) => 'https://economia.awesomeapi.com.br/json/daily/' + pair + '/' + days,
    market: 'https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,GBP-BRL,BTC-BRL',
    crossRates: 'https://open.er-api.com/v6/latest/BRL'
  };

  const SOURCE_LABEL = {
    awesomeapi: 'AwesomeAPI',
    'awesomeapi-cross': 'AwesomeAPI · cruzado',
    'exchangerate-api': 'exchangerate-api',
    local: 'valores locais',
    identity: 'mesma moeda'
  };

  const SHORTCUTS = [
    { keys: ['Enter'], desc: 'Converter o valor informado' },
    { keys: ['S'], desc: 'Inverter moedas de origem e destino' },
    { keys: ['C'], desc: 'Copiar o resultado' },
    { keys: ['/'], desc: 'Buscar uma moeda' },
    { keys: ['R'], desc: 'Buscar cotações novamente' },
    { keys: ['T'], desc: 'Alternar tema claro e escuro' },
    { keys: ['?'], desc: 'Mostrar esta lista de atalhos' },
    { keys: ['Esc'], desc: 'Fechar listas e diálogos' }
  ];

  const ICONS = {
    success: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.8 12.6l4.6 4.6L19.2 7.4"/></svg>',
    error: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.8v5M12 16.2h.01"/></svg>',
    info: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11.4v4.8M12 8h.01"/></svg>',
    warn: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.4v4.8M12 16.6h.01"/><path d="M10.3 3.9 2.6 17.4A1.7 1.7 0 0 0 4 20h16a1.7 1.7 0 0 0 1.5-2.6L13.7 3.9a1.7 1.7 0 0 0-3 0Z"/></svg>',
    close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
    arrow: '<svg class="icon hist__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 12h14.8M14.6 7.2 19.4 12l-4.8 4.8"/></svg>',
    trash: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.4 7.4h13.2M9.6 7.4V5.8a1.4 1.4 0 0 1 1.4-1.4h2a1.4 1.4 0 0 1 1.4 1.4v1.6M7.2 7.4l.8 11a1.4 1.4 0 0 0 1.4 1.2h5.2a1.4 1.4 0 0 0 1.4-1.2l.8-11"/></svg>',
    check: '<svg class="icon picker__opt-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.8 12.6l4.6 4.6L19.2 7.4"/></svg>'
  };

  /* ==========================================================================
     2. UTILIDADES
     ========================================================================== */
  const $ = (selector, scope) => (scope || document).querySelector(selector);
  const $$ = (selector, scope) => Array.prototype.slice.call((scope || document).querySelectorAll(selector));

  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
  const numberCache = new Map();

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function esc(text) {
    return String(text).replace(/[&<>"']/g, (character) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
    ));
  }

  function debounce(fn, wait) {
    let timer = null;
    return function debounced() {
      const args = arguments;
      const self = this;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(self, args), wait);
    };
  }

  function normalize(text) {
    return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function numberFormatter(minimum, maximum) {
    const key = minimum + ':' + maximum;
    if (!numberCache.has(key)) {
      numberCache.set(key, new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: minimum,
        maximumFractionDigits: maximum
      }));
    }
    return numberCache.get(key);
  }

  /** Casas decimais adequadas ao valor: cripto pode precisar de 8, moeda fiduciária usa 2. */
  function decimalsFor(value, code) {
    const currency = CURRENCIES[code];
    if (!currency || currency.kind !== 'crypto') return 2;
    const absolute = Math.abs(value);
    if (absolute >= 1) return 2;
    if (absolute >= 0.01) return 4;
    if (absolute >= 0.0001) return 6;
    return 8;
  }

  /** Número puro, sem símbolo (campos e animações). */
  function formatNumber(value, code, forcedDecimals) {
    const digits = typeof forcedDecimals === 'number' ? forcedDecimals : decimalsFor(value, code);
    return numberFormatter(Math.min(2, digits), digits).format(value);
  }

  /** Valor monetário com símbolo previsível (R$, US$, €, £, ₿). */
  function formatMoney(value, code) {
    if (!Number.isFinite(value)) return '—';
    const currency = CURRENCIES[code];
    return (currency ? currency.symbol : '') + '\u00a0' + formatNumber(value, code);
  }

  /** Cotação com precisão adaptativa: 4.612,35 · 5,0627 · 0,000024. */
  function formatRate(value, code) {
    if (!Number.isFinite(value)) return '—';
    const currency = CURRENCIES[code];
    const absolute = Math.abs(value);
    let decimals = 2;
    if (absolute < 1000) decimals = 4;
    if (absolute < 1) decimals = 6;
    if (absolute < 0.01) decimals = 8;
    const formatted = numberFormatter(2, decimals).format(value);
    return (currency ? currency.symbol : '') + '\u00a0' + formatted;
  }

  /** Cotação compacta para listas estreitas: R$ 412,5 mil. */
  function formatCompactRate(value, code) {
    if (!Number.isFinite(value)) return '—';
    if (Math.abs(value) < 10000) return formatRate(value, code);
    const currency = CURRENCIES[code];
    const compact = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    return (currency ? currency.symbol : '') + '\u00a0' + compact;
  }

  /** Converte texto digitado (pt-BR ou en-US) em número. */
  function parseAmount(raw) {
    if (raw == null) return NaN;
    let text = String(raw).replace(/[^\d.,-]/g, '');
    if (!text) return NaN;

    const hasComma = text.indexOf(',') > -1;
    const hasDot = text.indexOf('.') > -1;

    if (hasComma && hasDot) {
      // O separador que aparece por último é o decimal.
      if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
        text = text.replace(/\./g, '').replace(',', '.');
      } else {
        text = text.replace(/,/g, '');
      }
    } else if (hasComma) {
      text = text.replace(',', '.');
    } else if (hasDot) {
      const parts = text.split('.');
      const last = parts[parts.length - 1];
      const integer = parts[0];
      // "1.234" e "1.234.567" são milhares; "0.045", ".5" e "1.2345" são decimais.
      const isGrouping = parts.length > 2 || (last.length === 3 && integer !== '' && integer !== '0');
      if (isGrouping) text = parts.join('');
    }

    const value = Number(text);
    return Number.isFinite(value) ? value : NaN;
  }

  /** Máscara pt-BR aplicada ao valor numérico. */
  function maskAmount(value, code) {
    return Number.isFinite(value) ? formatNumber(value, code) : '';
  }

  let relativeFormatter = null;

  function relativeTime(timestamp) {
    if (!timestamp) return '—';
    const diff = timestamp - Date.now();
    const absolute = Math.abs(diff);
    const table = [
      ['year', 31536000000], ['month', 2592000000], ['day', 86400000],
      ['hour', 3600000], ['minute', 60000], ['second', 1000]
    ];
    for (let index = 0; index < table.length; index += 1) {
      const unit = table[index][0];
      const size = table[index][1];
      if (absolute >= size || unit === 'second') {
        const amount = Math.round(diff / size);
        try {
          if (!relativeFormatter) {
            relativeFormatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto', style: 'short' });
          }
          return relativeFormatter.format(amount, unit);
        } catch (error) {
          /* Navegador sem Intl.RelativeTimeFormat: texto simples equivalente. */
          return amount === 0 ? 'agora' : Math.abs(amount) + ' ' + unit;
        }
      }
    }
    return 'agora';
  }

  function absoluteTime(timestamp) {
    if (!timestamp) return '';
    return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeStyle: 'short' })
      .format(new Date(timestamp));
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  /* ==========================================================================
     3. PERSISTÊNCIA E CACHE
     ========================================================================== */
  const store = {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem(STORE_PREFIX + key);
        return raw === null ? (fallback === undefined ? null : fallback) : JSON.parse(raw);
      } catch (error) {
        return fallback === undefined ? null : fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
      } catch (error) { /* modo privado ou cota excedida: segue sem persistir */ }
    }
  };

  /** Cache com validade: informa também se o registro ainda está "fresco". */
  function cacheRead(key, ttl) {
    const hit = store.get('cache:' + key);
    if (!hit || typeof hit.savedAt !== 'number' || hit.value == null) return null;
    return { value: hit.value, savedAt: hit.savedAt, fresh: Date.now() - hit.savedAt < ttl };
  }

  function cacheWrite(key, value) {
    store.set('cache:' + key, { savedAt: Date.now(), value: value });
  }

  async function fetchJSON(url, timeout) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout || FETCH_TIMEOUT);
    try {
      const response = await window.fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
        mode: 'cors',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } finally {
      window.clearTimeout(timer);
    }
  }

  /* ==========================================================================
     4. SERVIÇO DE COTAÇÕES
     ========================================================================== */

  /** Normaliza a resposta da AwesomeAPI em um valor de cotação. */
  function parseAwesomeEntry(entry, invert) {
    if (!entry || !entry.bid) return null;

    const raw = Number(entry.bid);
    if (!Number.isFinite(raw) || raw <= 0) return null;

    const pctRaw = Number(entry.pctChange);
    /* A variação do par invertido não é o simples negativo: 1/(1+p) - 1. */
    const pctChange = invert && Number.isFinite(pctRaw)
      ? (1 / (1 + pctRaw / 100) - 1) * 100
      : pctRaw;

    return {
      rate: invert ? 1 / raw : raw,
      pctChange: pctChange,
      updatedAt: Date.parse(String(entry.create_date).replace(' ', 'T') + '-03:00') || Date.now(),
      source: 'awesomeapi'
    };
  }

  /** Busca a cotação do par, invertendo quando a API só publica o par oposto. */
  async function fetchPairRate(from, to) {
    const target = apiPair(from, to);
    if (!target.pair) throw new Error('Par sem cotação direta');
    const payload = await fetchJSON(APIS.pair(target.pair));
    const value = parseAwesomeEntry(payload[target.pair.replace('-', '')], target.invert);
    if (!value) throw new Error('Cotação indisponível');
    return value;
  }

  /** A resposta que chegou ainda pertence ao par que está na tela? */
  function isCurrentPair(from, to) {
    return state.from === from && state.to === to;
  }

  /** Cotação de 1 unidade de `from` em `to`, com cache e contingência. */
  async function loadRate(options) {
    const force = !!(options && options.force);
    const from = state.from;
    const to = state.to;

    if (from === to) {
      state.rate = { rate: 1, source: 'identity', updatedAt: Date.now(), pctChange: 0, stale: false, cached: false };
      return;
    }

    const cacheKey = 'rate:' + from + '-' + to;
    const cached = cacheRead(cacheKey, RATE_TTL);

    if (cached && cached.fresh && !force) {
      state.rate = Object.assign({}, cached.value, { cached: true, stale: false });
      revalidateRate();
      return;
    }

    setRateBusy(true);
    renderRate(); /* mostra o estado "Atualizando…" enquanto a rede responde */
    try {
      const value = await fetchPairRate(from, to);
      if (!isCurrentPair(from, to)) return;
      cacheWrite(cacheKey, value);
      state.rate = Object.assign({}, value, { cached: false, stale: false });
    } catch (error) {
      await fallbackRate(from, to, cached, cacheKey);
    } finally {
      setRateBusy(false);
    }
  }

  /** Revalidação silenciosa: aproveita o cache para pintar rápido e confirma na rede. */
  async function revalidateRate() {
    const from = state.from;
    const to = state.to;
    if (from === to) return;

    try {
      const value = await fetchPairRate(from, to);
      cacheWrite('rate:' + from + '-' + to, value);

      /* O par mudou enquanto a requisição estava em curso: descarta o resultado. */
      if (state.from !== from || state.to !== to) return;

      const changed = !state.rate || Math.abs(state.rate.rate - value.rate) > value.rate * 1e-6;
      state.rate = Object.assign({}, value, { cached: false, stale: false });
      renderRate();
      if (changed) renderResult({ animate: false });
      markSynced();
    } catch (error) { /* silencioso por definição */ }
  }

  /** Preço de 1 unidade da moeda em reais (painel de mercado ou requisição direta). */
  async function brlPrice(code) {
    if (code === 'BRL') return { value: 1, at: Date.now() };

    const known = state.market && state.market[code];
    if (known && Number.isFinite(known.brl) && known.brl > 0) {
      return { value: known.brl, at: known.updatedAt || Date.now() };
    }

    try {
      const payload = await fetchJSON(APIS.pair(code + '-BRL'));
      const entry = payload[code + 'BRL'];
      const value = Number(entry && entry.bid);
      if (!Number.isFinite(value) || value <= 0) return null;
      return {
        value: value,
        at: Date.parse(String(entry.create_date).replace(' ', 'T') + '-03:00') || Date.now()
      };
    } catch (error) {
      return null;
    }
  }

  /** Cruzamento via real: cobre pares que a AwesomeAPI não publica (ex.: BTC-GBP). */
  async function awesomeCrossRate(from, to) {
    const prices = await Promise.all([brlPrice(from), brlPrice(to)]);
    if (!prices[0] || !prices[1] || !prices[0].value || !prices[1].value) return null;
    return {
      rate: prices[0].value / prices[1].value,
      updatedAt: Math.min(prices[0].at, prices[1].at)
    };
  }

  /** Caminhos alternativos quando a AwesomeAPI não responde. */
  async function fallbackRate(from, to, cached, cacheKey) {
    /* 1) Cruzamento com o real: só usa pares que a API sempre publica. */
    const cross = await awesomeCrossRate(from, to);
    if (cross && Number.isFinite(cross.rate) && cross.rate > 0) {
      if (!isCurrentPair(from, to)) return;
      state.rate = {
        rate: cross.rate,
        pctChange: null,
        updatedAt: cross.updatedAt || Date.now(),
        source: 'awesomeapi-cross',
        cached: false,
        stale: false
      };
      cacheWrite(cacheKey, Object.assign({}, state.rate));
      return;
    }

    /* 2) Tabela do exchangerate-api. */
    const crossCached = cacheRead('cross', MARKET_TTL);
    let table = null;
    let tableAt = null;
    let fromCache = false;

    if (crossCached && crossCached.fresh) {
      table = crossCached.value.table;
      tableAt = crossCached.value.at;
      fromCache = true;
    } else {
      try {
        const payload = await fetchJSON(APIS.crossRates);
        if (payload && payload.rates) {
          table = { BRL: 1 };
          ['USD', 'EUR', 'GBP'].forEach((code) => {
            if (payload.rates[code]) table[code] = 1 / payload.rates[code];
          });
          table.BTC = (state.market && state.market.BTC && state.market.BTC.brl) || FALLBACK_BRL_PER.BTC;
          tableAt = payload.time_last_update_unix ? payload.time_last_update_unix * 1000 : Date.now();
          cacheWrite('cross', { table: table, at: tableAt });
        }
      } catch (error) {
        table = null;
      }
    }

    /* O par pode ter mudado durante a requisição da tabela: descarta o que chegou. */
    if (!isCurrentPair(from, to)) return;

    if (table && table[from] && table[to]) {
      state.rate = {
        rate: table[from] / table[to],
        pctChange: null,
        updatedAt: tableAt || Date.now(),
        source: 'exchangerate-api',
        cached: fromCache,
        stale: true
      };
      cacheWrite(cacheKey, Object.assign({}, state.rate, { cached: false }));
      return;
    }

    if (cached) {
      state.rate = Object.assign({}, cached.value, { cached: true, stale: true });
      return;
    }

    state.rate = {
      rate: FALLBACK_BRL_PER[from] / FALLBACK_BRL_PER[to],
      pctChange: null,
      updatedAt: FALLBACK_DATE,
      source: 'local',
      cached: false,
      stale: true
    };
  }

  /** Série dos últimos dias do par selecionado (para o gráfico). */
  async function loadSeries() {
    const from = state.from;
    const to = state.to;

    if (from === to) {
      state.series = null;
      return;
    }

    const cacheKey = 'series:' + from + '-' + to + ':' + SERIES_DAYS;
    const cached = cacheRead(cacheKey, SERIES_TTL);

    if (cached && cached.fresh) {
      state.series = Object.assign({}, cached.value, { cached: true });
      return;
    }

    try {
      const target = apiPair(from, to);
      if (!target.pair) throw new Error('Série indisponível para este par');
      const payload = await fetchJSON(APIS.daily(target.pair, SERIES_DAYS));
      if (!Array.isArray(payload)) throw new Error('Série indisponível');

      const points = payload.slice().reverse()
        .map((item) => Number(item.bid))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => (target.invert ? 1 / value : value));

      if (points.length < 3) throw new Error('Série insuficiente');
      if (!isCurrentPair(from, to)) return;

      const value = {
        points: points,
        first: points[0],
        last: points[points.length - 1],
        min: Math.min.apply(null, points),
        max: Math.max.apply(null, points),
        avg: points.reduce((total, item) => total + item, 0) / points.length,
        days: points.length,
        source: 'awesomeapi'
      };
      value.change = ((value.last - value.first) / value.first) * 100;

      cacheWrite(cacheKey, value);
      state.series = Object.assign({}, value, { cached: false });
    } catch (error) {
      if (!isCurrentPair(from, to)) return;
      state.series = cached ? Object.assign({}, cached.value, { cached: true }) : null;
    }
  }

  /** Painel de mercado: pares contra o real. */
  async function loadMarket(force) {
    const cached = cacheRead('market', MARKET_TTL);

    if (cached && cached.fresh && !force) {
      state.market = cached.value;
      return;
    }

    try {
      const payload = await fetchJSON(APIS.market);
      const market = {};
      ['USD', 'EUR', 'GBP', 'BTC'].forEach((code) => {
        const entry = payload[code + 'BRL'];
        if (entry) {
          market[code] = {
            brl: Number(entry.bid),
            pctChange: Number(entry.pctChange),
            updatedAt: Date.parse(String(entry.create_date).replace(' ', 'T') + '-03:00') || Date.now()
          };
        }
      });
      if (!Object.keys(market).length) throw new Error('Painel indisponível');
      cacheWrite('market', market);
      state.market = market;
    } catch (error) {
      /* O painel em memória é mais recente que o cache antigo. */
      state.market = state.market || (cached ? cached.value : null);
    }
  }

  /* ==========================================================================
     5. ESTADO DA APLICAÇÃO
     ========================================================================== */
  const state = {
    from: 'BRL',
    to: 'USD',
    amount: 100,
    amountValid: false,
    rate: null,
    series: null,
    market: null,
    history: [],
    rateBusy: false,
    ratePending: false,
    lastSync: null
  };

  const dom = {
    card: $('.card--fx'),
    form: $('#fxForm'),
    amountInput: $('#amountInput'),
    amountShell: $('#amountShell'),
    amountError: $('#amountError'),
    amountErrorText: $('#amountErrorText'),
    clearAmount: $('#clearAmount'),
    fromSymbol: $('#fromSymbol'),
    toSymbol: $('#toSymbol'),
    resultValue: $('#resultValue'),
    resultShell: $('#resultShell'),
    resultLabel: $('#resultLabel'),
    rateLine: $('#rateLine'),
    rateAlt: $('#rateAlt'),
    rateMeta: $('.rate'),
    rateUpdated: $('#rateUpdated'),
    sourcePill: $('#sourcePill'),
    sourcePillText: $('#sourcePillText'),
    convertBtn: $('#convertBtn'),
    refreshBtn: $('#refreshBtn'),
    swapBtn: $('#swapBtn'),
    copyBtn: $('#copyBtn'),
    copyBtnText: $('#copyBtnText'),
    shareBtn: $('#shareBtn'),
    themeToggle: $('#themeToggle'),
    themeToggleLabel: $('#themeToggleLabel'),
    shortcutsBtn: $('#shortcutsBtn'),
    shortcutsBtnFoot: $('#shortcutsBtnFoot'),
    shortcutsDialog: $('#shortcutsDialog'),
    shortcutsClose: $('#shortcutsClose'),
    shortcutsList: $('#shortcutsList'),
    trend: $('#trend'),
    trendTitle: $('#trendTitle'),
    trendTag: $('#trendTag'),
    trendMin: $('#trendMin'),
    trendMax: $('#trendMax'),
    trendAvg: $('#trendAvg'),
    spark: $('#spark'),
    watchList: $('#watchList'),
    marketRefresh: $('#marketRefresh'),
    historyList: $('#historyList'),
    historyEmpty: $('#historyEmpty'),
    historyCount: $('#historyCount'),
    clearHistory: $('#clearHistory'),
    toasts: $('#toasts'),
    announcer: $('#announcer'),
    netPill: $('#netPill'),
    netPillText: $('#netPillText'),
    metaThemeColor: $('#metaThemeColor'),
    appVersion: $('#appVersion'),
    lastSync: $('#lastSync'),
    picks: {
      from: { root: $('#pickerFrom'), input: $('#fromSearch'), list: $('#fromList'), flag: $('#fromFlag') },
      to: { root: $('#pickerTo'), input: $('#toSearch'), list: $('#toList'), flag: $('#toFlag') }
    }
  };

  /* ==========================================================================
     6. RENDERIZAÇÃO
     ========================================================================== */

  /* ---------- 6.1 Notificações ---------- */
  function toast(message, type, options) {
    const settings = options || {};
    const variant = type || 'info';
    const node = document.createElement('div');
    node.className = 'toast toast--' + variant;
    node.innerHTML =
      '<span class="toast__icon">' + (ICONS[variant] || ICONS.info) + '</span>' +
      '<div class="toast__text"></div>' +
      '<button type="button" class="toast__close" aria-label="Fechar notificação">' + ICONS.close + '</button>';

    const textBox = $('.toast__text', node);
    if (settings.title) {
      const strong = document.createElement('b');
      strong.textContent = settings.title;
      textBox.appendChild(strong);
    }
    textBox.appendChild(document.createTextNode(message));

    const remove = () => {
      if (!node.isConnected) return;
      node.classList.add('is-leaving');
      window.setTimeout(() => node.remove(), 220);
    };

    $('.toast__close', node).addEventListener('click', remove);
    dom.toasts.appendChild(node);

    while (dom.toasts.children.length > 3) dom.toasts.firstElementChild.remove();

    window.setTimeout(remove, settings.duration || 4200);
  }

  function announce(message) {
    dom.announcer.textContent = message;
  }

  /* ---------- 6.2 Campos de moeda ---------- */
  function currencyLabel(code) {
    const currency = CURRENCIES[code];
    return currency.short + ' (' + currency.code + ')';
  }

  function applyPickerVisual(side, force) {
    const code = side === 'from' ? state.from : state.to;
    const currency = CURRENCIES[code];
    const pick = dom.picks[side];

    /* Ao confirmar uma escolha o rótulo é reescrito mesmo com o campo em foco. */
    if (force || document.activeElement !== pick.input) pick.input.value = currencyLabel(code);
    pick.flag.src = currency.flag;
    pick.flag.alt = 'Bandeira de ' + currency.name;
    pick.flag.dataset.crypto = String(currency.kind === 'crypto');
  }

  function renderMeta() {
    const from = CURRENCIES[state.from];
    const to = CURRENCIES[state.to];

    setText(dom.fromSymbol, from.symbol);
    setText(dom.toSymbol, to.symbol);
    dom.amountInput.setAttribute('aria-label', 'Você envia: valor em ' + from.name);
    setText(dom.resultLabel, 'Você recebe em ' + to.short);

    applyPickerVisual('from');
    applyPickerVisual('to');
  }

  function renderRate() {
    const rate = state.rate;

    if (!rate) {
      setText(dom.rateLine, '1 ' + state.from + ' = —');
      setText(dom.rateAlt, '');
      setText(dom.rateUpdated, 'Buscando cotações…');
      dom.rateMeta.dataset.stale = 'false';
      return;
    }

    /* Troca de par em curso: não mostrar a cotação antiga com a moeda nova. */
    if (state.ratePending) {
      setText(dom.rateLine, '1 ' + state.from + ' = —');
      setText(dom.rateAlt, 'Buscando a cotação de ' + state.from + '/' + state.to + '…');
      setText(dom.rateUpdated, 'Atualizando cotações…');
      dom.rateMeta.dataset.stale = 'true';
      dom.sourcePill.dataset.state = 'loading';
      setText(dom.sourcePillText, 'Atualizando…');
      return;
    }

    if (state.from === state.to) {
      setText(dom.rateLine, '1 ' + state.from + ' = 1 ' + state.to + ' · mesma moeda');
      setText(dom.rateAlt, 'Escolha duas moedas diferentes para ver a variação.');
    } else {
      setText(dom.rateLine, '1 ' + state.from + ' = ' + formatRate(rate.rate, state.to));
      const sameDay = new Date(rate.updatedAt).toDateString() === new Date().toDateString();
      const period = sameDay ? 'hoje' : 'última sessão';
      const today = Number.isFinite(rate.pctChange)
        ? '  ·  ' + period + ' ' + (rate.pctChange >= 0 ? '+' : '') + rate.pctChange.toFixed(2).replace('.', ',') + '%'
        : '';
      setText(dom.rateAlt, 'Inverso: 1 ' + state.to + ' = ' + formatRate(1 / rate.rate, state.from) + today);
    }

    const source = SOURCE_LABEL[rate.source] || rate.source;
    setText(dom.rateUpdated, 'Atualizado ' + relativeTime(rate.updatedAt) + ' · ' + source + (rate.cached ? ' (cache)' : ''));
    dom.rateUpdated.title = absoluteTime(rate.updatedAt);
    dom.rateMeta.dataset.stale = String(!!rate.stale);

    let pillState = 'live';
    let pillLabel = source;
    if (state.rateBusy) {
      pillState = 'loading';
      pillLabel = 'Atualizando…';
    } else if (rate.source === 'local') {
      pillState = 'offline';
      pillLabel = SOURCE_LABEL.local;
    } else if (rate.cached) {
      pillState = 'cache';
      pillLabel = source + ' · cache';
    }
    dom.sourcePill.dataset.state = pillState;
    setText(dom.sourcePillText, pillLabel);
    dom.sourcePill.title = 'Fonte das cotações: ' + source + ' · ' + absoluteTime(rate.updatedAt);
  }

  /* ---------- 6.3 Valor convertido ---------- */
  let tweenFrame = null;
  let tweenTimer = null;

  function paintResult(value, code, animate) {
    const node = dom.resultValue;
    const from = Number(node.dataset.value || 0);
    const target = Number.isFinite(value) ? value : 0;
    /* Fixa a precisão do alvo para o número não "tremer" durante a animação. */
    const digits = decimalsFor(target, code);

    if (tweenFrame) window.cancelAnimationFrame(tweenFrame);
    if (tweenTimer) window.clearTimeout(tweenTimer);
    tweenFrame = null;
    tweenTimer = null;

    const settle = () => {
      node.textContent = formatNumber(target, code, digits);
      node.dataset.value = String(target);
    };

    if (!animate || REDUCED_MOTION.matches || !Number.isFinite(from)) {
      settle();
      return;
    }

    const start = window.performance.now();
    const duration = 420;

    const step = (now) => {
      const progress = clamp((now - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = formatNumber(from + (target - from) * eased, code, digits);
      if (progress < 1) {
        tweenFrame = window.requestAnimationFrame(step);
      } else {
        tweenFrame = null;
        settle();
      }
    };

    node.dataset.value = String(target);
    node.textContent = formatNumber(from, code, digits);
    tweenFrame = window.requestAnimationFrame(step);

    /* Garantia: com a aba em segundo plano o rAF fica suspenso; o valor final
       precisa aparecer de qualquer forma. */
    tweenTimer = window.setTimeout(() => {
      tweenTimer = null;
      if (tweenFrame) {
        window.cancelAnimationFrame(tweenFrame);
        tweenFrame = null;
      }
      settle();
    }, duration + 160);
  }

  function renderResult(options) {
    const settings = options || {};
    const rate = state.rate ? state.rate.rate : NaN;
    const result = state.amount * rate;
    const valid = state.amountValid && Number.isFinite(result);

    paintResult(valid ? result : 0, state.to, !!settings.animate && valid);
    dom.resultShell.dataset.value = String(valid ? result : 0);
    return valid ? result : null;
  }

  /** Enquanto a cotação do par novo não chega, o bloco fica marcado e copiar/compartilhar
      desligados: nada de copiar o número do par anterior. */
  function setResultPending(pending) {
    state.ratePending = !!pending;
    dom.resultShell.classList.toggle('is-updating', pending);
    dom.resultShell.setAttribute('aria-busy', String(pending));
    dom.copyBtn.disabled = pending;
    dom.shareBtn.disabled = pending;
    renderRate();
  }

  /* ---------- 6.4 Tendência (sparkline) ---------- */
  function sparkline(points) {
    const width = 600;
    const height = 130;
    const padding = 12;
    const min = Math.min.apply(null, points);
    const max = Math.max.apply(null, points);
    const span = (max - min) || Math.abs(max) || 1;
    const stepX = (width - padding * 2) / (points.length - 1);
    const scaleY = (value) => padding + (height - padding * 2) * (1 - (value - min) / span);

    const coords = points.map((value, index) => [
      Number((padding + index * stepX).toFixed(2)),
      Number(scaleY(value).toFixed(2))
    ]);

    let line = 'M ' + coords[0][0] + ' ' + coords[0][1];
    for (let index = 1; index < coords.length; index += 1) {
      const previous = coords[index - 1];
      const current = coords[index];
      const control = (current[0] - previous[0]) * 0.42;
      line += ' C ' + (previous[0] + control).toFixed(2) + ' ' + previous[1] +
        ', ' + (current[0] - control).toFixed(2) + ' ' + current[1] +
        ', ' + current[0] + ' ' + current[1];
    }

    const area = line + ' L ' + coords[coords.length - 1][0] + ' ' + height +
      ' L ' + coords[0][0] + ' ' + height + ' Z';
    const last = coords[coords.length - 1];
    const rising = points[points.length - 1] >= points[0];
    const stroke = rising ? '#22c55e' : '#f43f5e';

    return '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" role="img" ' +
      'aria-label="Série de cotações dos últimos ' + points.length + ' dias">' +
      '<defs><linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + stroke + '" stop-opacity=".3"/>' +
      '<stop offset="1" stop-color="' + stroke + '" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#sparkFill)"/>' +
      '<path d="' + line + '" fill="none" stroke="' + stroke + '" stroke-width="2.4" ' +
      'vector-effect="non-scaling-stroke" stroke-linecap="round"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="4" fill="' + stroke + '" ' +
      'vector-effect="non-scaling-stroke"/>' +
      '</svg>';
  }

  function renderSeries() {
    const series = state.series;
    const hidden = !series || series.points.length < 3 || state.from === state.to;

    dom.trend.hidden = hidden;
    if (hidden) return;

    const code = state.to;
    dom.spark.innerHTML = sparkline(series.points);

    const change = series.change;
    dom.trendTag.dataset.dir = change > 0.05 ? 'up' : (change < -0.05 ? 'down' : 'flat');
    setText(dom.trendTag, (change >= 0 ? '+' : '') + change.toFixed(2).replace('.', ',') + '%');
    setText(dom.trendTitle, 'Variação nos últimos ' + series.days + ' dias');
    setText(dom.trendMin, formatRate(series.min, code));
    setText(dom.trendMax, formatRate(series.max, code));
    setText(dom.trendAvg, formatRate(series.avg, code));
  }

  /* ---------- 6.5 Painel de mercado ---------- */
  function renderMarket() {
    const market = state.market;

    if (!market) {
      dom.watchList.innerHTML = '<li class="watch__error">' +
        '<p class="watch__error-text">Não foi possível carregar o mercado agora.</p>' +
        '<button type="button" class="ghost-btn" id="marketRetry">Tentar de novo</button></li>';
      return;
    }

    dom.watchList.innerHTML = ['USD', 'EUR', 'GBP', 'BTC'].filter((code) => market[code]).map((code) => {
      const currency = CURRENCIES[code];
      const item = market[code];
      const direction = item.pctChange > 0.05 ? 'up' : (item.pctChange < -0.05 ? 'down' : 'flat');
      const prefix = item.pctChange > 0 ? '+' : '';
      return '<li>' +
        '<button type="button" class="watch__item" data-code="' + code + '" ' +
        'title="Carregar ' + esc(currency.name) + ' no conversor">' +
        '<img class="watch__flag" data-crypto="' + (currency.kind === 'crypto') + '" src="' + currency.flag + '" alt="">' +
        '<span class="watch__name">' +
        '<span class="watch__label">' + esc(currency.short) + '</span>' +
        '<span class="watch__code">1 ' + code + ' em BRL</span>' +
        '</span>' +
        '<span class="watch__rate">' + formatCompactRate(item.brl, 'BRL') + '</span>' +
        '<span class="watch__delta" data-dir="' + direction + '">' + prefix +
        item.pctChange.toFixed(2).replace('.', ',') + '%</span>' +
        '</button></li>';
    }).join('');
  }

  /* ---------- 6.6 Histórico ---------- */
  function saveHistory() {
    store.set('history', state.history);
  }

  function renderHistory() {
    const history = state.history;
    dom.clearHistory.hidden = history.length === 0;
    dom.historyEmpty.hidden = history.length > 0;
    setText(dom.historyCount, history.length === 0
      ? 'Nenhuma conversão salva'
      : history.length + (history.length === 1 ? ' conversão salva' : ' conversões salvas'));

    dom.historyList.innerHTML = history.map((item) => {
      const from = CURRENCIES[item.from];
      const to = CURRENCIES[item.to];
      return '<li class="hist__item">' +
        '<button type="button" class="hist__load" data-id="' + esc(item.id) + '" title="Reutilizar esta conversão">' +
        '<span class="hist__line hist__line--in">' +
        '<img class="hist__flag" data-crypto="' + (from.kind === 'crypto') + '" src="' + from.flag + '" alt="">' +
        '<span class="hist__value">' + formatMoney(item.amount, item.from) + '</span>' +
        '<span class="hist__time">' + relativeTime(item.at) + '</span>' +
        '</span>' +
        '<span class="hist__line hist__line--out">' + ICONS.arrow +
        '<img class="hist__flag" data-crypto="' + (to.kind === 'crypto') + '" src="' + to.flag + '" alt="">' +
        '<span class="hist__value">' + formatMoney(item.result, item.to) + '</span>' +
        '</span>' +
        '</button>' +
        '<button type="button" class="hist__del" data-delete="' + esc(item.id) + '" aria-label="Remover esta conversão">' +
        ICONS.trash + '</button>' +
        '</li>';
    }).join('');
  }

  function addToHistory(amount, result) {
    const entry = {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      from: state.from,
      to: state.to,
      amount: amount,
      result: result,
      at: Date.now()
    };

    state.history = state.history.filter((item) => !(
      item.from === entry.from && item.to === entry.to && Math.abs(item.amount - entry.amount) < 1e-9
    ));
    state.history.unshift(entry);
    state.history = state.history.slice(0, HISTORY_MAX);
    saveHistory();
    renderHistory();
  }

  /* ---------- 6.7 Sincronização e rede ---------- */
  function renderSync() {
    setText(dom.lastSync, state.lastSync
      ? 'sincronizado ' + relativeTime(state.lastSync)
      : 'sem sincronizar');
  }

  function renderNetwork() {
    const online = navigator.onLine;
    dom.netPill.dataset.state = online ? 'online' : 'offline';
    setText(dom.netPillText, online ? 'Online' : 'Offline');
    dom.netPill.title = online
      ? 'Conectado: cotações em tempo real'
      : 'Sem conexão: usando as cotações salvas';
  }

  function setRateBusy(busy) {
    state.rateBusy = busy;
    dom.convertBtn.classList.toggle('is-busy', busy);
    dom.convertBtn.disabled = busy;
    dom.refreshBtn.disabled = busy;
  }

  function markSynced() {
    if (state.rate && (state.rate.source === 'awesomeapi' || state.rate.source === 'awesomeapi-cross')) {
      state.lastSync = Date.now();
      renderSync();
    }
  }

  /* ==========================================================================
     7. SELETOR DE MOEDA ACESSÍVEL (COMBOBOX)
     ========================================================================== */
  function createPicker(side) {
    const refs = dom.picks[side];
    const input = refs.input;
    const list = refs.list;
    const root = refs.root;

    let options = [];
    let activeIndex = -1;
    let open = false;
    let query = '';

    const selectedCode = () => (side === 'from' ? state.from : state.to);

    function buildOptions() {
      const selected = selectedCode();

      options = CODES.filter((code) => {
        if (!query) return true;
        const currency = CURRENCIES[code];
        return normalize([currency.name, currency.short, currency.code].join(' ')).indexOf(query) > -1;
      });

      if (!options.length) {
        /* Mensagem como opção desativada: o leitor de tela anuncia a busca vazia. */
        list.innerHTML = '<li class="picker__empty" id="' + side + '-opt-empty" role="option" ' +
          'aria-disabled="true" aria-selected="false">Nenhuma moeda encontrada para <b>' +
          esc(query) + '</b>.</li>';
        activeIndex = -1;
        input.setAttribute('aria-activedescendant', side + '-opt-empty');
        return;
      }

      list.innerHTML = options.map((code, index) => {
        const currency = CURRENCIES[code];
        const market = state.market && state.market[code];
        const reference = code === 'BRL' ? 'base' : (market && market.brl ? formatCompactRate(market.brl, 'BRL') : '');
        const isSelected = code === selected;

        return '<li class="picker__opt' + (isSelected ? ' is-selected' : '') +
          (index === activeIndex ? ' is-active' : '') + '" id="' + side + '-opt-' + code + '"' +
          ' role="option" tabindex="-1" data-code="' + code + '" aria-selected="' + isSelected + '">' +
          '<img class="picker__opt-flag" data-crypto="' + (currency.kind === 'crypto') + '" src="' + currency.flag + '" alt="">' +
          '<span class="picker__opt-text">' +
          '<span class="picker__opt-name">' + esc(currency.name) + '</span>' +
          '<span class="picker__opt-code">' + currency.code + '</span>' +
          '</span>' +
          (reference ? '<span class="picker__opt-rate">' + reference + '</span>' : '') +
          ICONS.check +
          '</li>';
      }).join('');

      if (activeIndex > options.length - 1) activeIndex = options.length - 1;
      syncActive();
    }

    function syncActive() {
      $$('.picker__opt', list).forEach((node, index) => {
        node.classList.toggle('is-active', index === activeIndex);
        node.setAttribute('aria-selected', String(node.dataset.code === selectedCode()));
      });

      const activeCode = activeIndex >= 0 ? options[activeIndex] : null;
      if (!activeCode) {
        input.removeAttribute('aria-activedescendant');
        return;
      }

      input.setAttribute('aria-activedescendant', side + '-opt-' + activeCode);

      const target = list.querySelector('[data-code="' + activeCode + '"]');
      if (target) {
        const box = list.getBoundingClientRect();
        const item = target.getBoundingClientRect();
        if (item.top < box.top || item.bottom > box.bottom) target.scrollIntoView({ block: 'nearest' });
      }
    }

    function openList() {
      if (open) return;
      open = true;
      root.dataset.open = 'true';
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      query = '';
      const current = CODES.indexOf(selectedCode());
      activeIndex = current < 0 ? 0 : current;
      buildOptions();
      if (document.activeElement === input) input.select();
    }

    function closeList(restoreValue) {
      if (!open) return;
      open = false;
      root.dataset.open = 'false';
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      query = '';
      activeIndex = -1;
      if (restoreValue !== false) applyPickerVisual(side);
    }

    function commit(code) {
      if (!CURRENCIES[code]) return;
      closeList(false);
      /* Primeiro aplica a escolha; depois reescreve o rótulo com o estado novo,
         mesmo que o campo continue em foco. */
      onCurrencySelected(side, code);
      applyPickerVisual(side, true);
    }

    /* Foco por teclado: seleciona o rótulo para digitar por cima, sem abrir a
       lista sozinho (padrão APG: abre com seta, clique ou digitação). */
    input.addEventListener('focus', () => {
      if (input.value === currencyLabel(selectedCode())) input.select();
    });
    input.addEventListener('click', openList);
    input.addEventListener('blur', () => applyPickerVisual(side));

    /* Clicar na bandeira, no código ou na seta também abre a lista. */
    refs.root.querySelector('.picker__control').addEventListener('click', (event) => {
      if (event.target === input) return;
      input.focus();
      openList(); /* idempotente: ignora se a lista já estiver aberta */
    });

    input.addEventListener('input', () => {
      query = normalize(input.value);
      if (!open) openList();
      activeIndex = 0;
      buildOptions();
    });

    input.addEventListener('keydown', (event) => {
      const key = event.key;

      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        if (!open) {
          openList();
          return;
        }
        if (!options.length) return;
        const delta = key === 'ArrowDown' ? 1 : -1;
        activeIndex = (activeIndex + delta + options.length) % options.length;
        syncActive();
        return;
      }

      if (key === 'Home' || key === 'End') {
        if (!open || !options.length) return;
        event.preventDefault();
        activeIndex = key === 'Home' ? 0 : options.length - 1;
        syncActive();
        return;
      }

      if (key === 'Enter') {
        if (open && activeIndex >= 0 && options[activeIndex]) {
          event.preventDefault();
          commit(options[activeIndex]);
        } else {
          closeList();
        }
        return;
      }

      if (key === 'Escape' && open) {
        event.preventDefault();
        event.stopPropagation();
        closeList();
        return;
      }

      if (key === 'Tab') closeList();
    });

    /* Impede que o clique roube o foco antes de confirmar a escolha. */
    list.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const option = event.target.closest && event.target.closest('.picker__opt');
      if (option) commit(option.dataset.code);
    });

    list.addEventListener('click', (event) => {
      if (!open) return;
      const option = event.target.closest && event.target.closest('.picker__opt');
      if (option) commit(option.dataset.code);
    });

    list.addEventListener('mousemove', (event) => {
      const option = event.target.closest && event.target.closest('.picker__opt');
      if (!option) return;
      const index = options.indexOf(option.dataset.code);
      if (index > -1 && index !== activeIndex) {
        activeIndex = index;
        syncActive();
      }
    });

    document.addEventListener('pointerdown', (event) => {
      if (open && !root.contains(event.target)) closeList();
    });

    return {
      refresh: () => { if (open) buildOptions(); },
      close: () => closeList(),
      open: () => { input.focus(); openList(); }
    };
  }

  /* ==========================================================================
     8. CONVERSÃO E HISTÓRICO
     ========================================================================== */

  /** Aplica a moeda escolhida (evitando moedas repetidas) e recarrega o par. */
  function onCurrencySelected(side, code) {
    if (!CURRENCIES[code]) return;

    if (side === 'from') {
      if (code === state.to) state.to = state.from;
      state.from = code;
    } else {
      if (code === state.from) state.from = state.to;
      state.to = code;
    }

    renderMeta();
    setResultPending(true); /* o resultado do par novo só aparece quando a cotação chega */
    updateChips();
    urlSync();
    savePreferences();
    reloadPair();
  }

  const pickers = {
    from: createPicker('from'),
    to: createPicker('to')
  };

  function showAmountError(message) {
    if (!message) {
      dom.amountError.hidden = true;
      dom.amountShell.dataset.invalid = 'false';
      dom.amountInput.removeAttribute('aria-invalid');
      return;
    }
    setText(dom.amountErrorText, message);
    dom.amountError.hidden = false;
    dom.amountShell.dataset.invalid = 'true';
    dom.amountInput.setAttribute('aria-invalid', 'true');
  }

  function validateAmount(showEmptyError) {
    const raw = dom.amountInput.value.trim();

    if (!raw) {
      state.amountValid = false;
      state.amount = 0;
      showAmountError(showEmptyError ? 'Informe um valor para converter.' : '');
      return false;
    }

    const value = parseAmount(raw);

    if (!Number.isFinite(value)) {
      state.amountValid = false;
      showAmountError('Use apenas números, vírgula ou ponto.');
      return false;
    }

    if (value <= 0) {
      state.amountValid = false;
      state.amount = value;
      /* No envio é erro; durante a digitação "0" ainda pode virar "0,5". */
      showAmountError(showEmptyError ? 'Informe um valor maior que zero.' : '');
      return false;
    }

    if (value > 1e15) {
      state.amountValid = false;
      showAmountError('Valor muito alto para converter.');
      return false;
    }

    state.amountValid = true;
    state.amount = value;
    showAmountError('');
    return true;
  }

  const liveConvert = debounce(() => {
    validateAmount(false);
    renderResult({ animate: true });
    updateChips();
    urlSync();
  }, DEBOUNCE_MS);

  function updateChips() {
    $$('.chip', dom.form).forEach((chip) => {
      const value = Number(chip.dataset.amount);
      chip.setAttribute('aria-pressed', String(state.amountValid && Math.abs(value - state.amount) < 1e-9));
    });
    dom.clearAmount.hidden = !dom.amountInput.value;
  }

  function commitConversion() {
    if (!validateAmount(true)) {
      dom.amountInput.focus();
      toast('Confira o valor informado para continuar.', 'warn', { title: 'Valor inválido' });
      return;
    }

    /* Sem a cotação do par ainda: melhor avisar do que registrar um resultado falso. */
    if (!state.rate) {
      setResultPending(true);
      toast('Buscando a cotação deste par…', 'warn', { title: 'Só um instante', duration: 2600 });
      reloadPair();
      return;
    }

    renderResult({ animate: true });
    updateChips();
    urlSync();
    savePreferences();
    renderRate();
    markSynced();

    const result = state.amount * state.rate.rate;
    if (Number.isFinite(result)) {
      addToHistory(state.amount, result);
      announce(formatMoney(state.amount, state.from) + ' equivalem a ' + formatMoney(result, state.to));
      toast(formatMoney(state.amount, state.from) + ' = ' + formatMoney(result, state.to), 'success', {
        title: 'Conversão registrada'
      });
    }
  }

  function swapCurrencies() {
    const previous = state.from;
    state.from = state.to;
    state.to = previous;

    dom.swapBtn.classList.remove('is-swapping');
    void dom.swapBtn.offsetWidth;
    dom.swapBtn.classList.add('is-swapping');

    dom.amountInput.value = state.amountValid ? maskAmount(state.amount, state.from) : '';
    renderMeta();
    setResultPending(true);
    updateChips();
    urlSync();
    announce('Moedas invertidas: de ' + CURRENCIES[state.from].name + ' para ' + CURRENCIES[state.to].name);
    reloadPair();
  }

  async function copyResult() {
    const value = Number(dom.resultShell.dataset.value || 0);
    const text = formatMoney(value, state.to) + ' (' + formatNumber(value, state.to) + ' ' + state.to + ')';

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const helper = document.createElement('textarea');
        helper.value = text;
        helper.setAttribute('readonly', 'readonly');
        helper.style.position = 'fixed';
        helper.style.top = '-1000px';
        document.body.appendChild(helper);
        helper.select();
        document.execCommand('copy');
        helper.remove();
      }

      dom.copyBtn.classList.add('is-copied');
      setText(dom.copyBtnText, 'Copiado!');
      window.setTimeout(() => {
        dom.copyBtn.classList.remove('is-copied');
        setText(dom.copyBtnText, 'Copiar');
      }, 1800);
      toast(text, 'success', { title: 'Resultado copiado' });
    } catch (error) {
      toast('Selecione o valor manualmente para copiar.', 'error', { title: 'Falha ao copiar' });
    }
  }

  /* ---------- URL compartilhável ---------- */
  function urlSync() {
    try {
      const params = new URLSearchParams();
      params.set('de', state.from);
      params.set('para', state.to);
      if (Number.isFinite(state.amount) && state.amount > 0) {
        params.set('valor', String(state.amount).replace('.', ','));
      }
      window.history.replaceState(null, '', window.location.pathname + '?' + params.toString());
    } catch (error) { /* file:// restrito: segue sem sincronizar a URL */ }
  }

  function readUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const from = (params.get('de') || '').toUpperCase();
      const to = (params.get('para') || '').toUpperCase();
      const amount = params.get('valor');
      return {
        from: CURRENCIES[from] ? from : null,
        to: CURRENCIES[to] ? to : null,
        amount: amount ? parseAmount(amount) : NaN
      };
    } catch (error) {
      return { from: null, to: null, amount: NaN };
    }
  }

  async function shareConversion() {
    const value = Number(dom.resultShell.dataset.value || 0);
    const text = formatMoney(state.amount, state.from) + ' = ' + formatMoney(value, state.to) + ' · Convert Money DevClub';
    const url = window.location.href;

    try {
      if (navigator.share) {
        await navigator.share({ title: 'Convert Money · DevClub', text: text, url: url });
        return;
      }

      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text + '\n' + url);
      } else {
        const helper = document.createElement('textarea');
        helper.value = text + '\n' + url;
        helper.setAttribute('readonly', 'readonly');
        helper.style.position = 'fixed';
        helper.style.top = '-1000px';
        document.body.appendChild(helper);
        helper.select();
        document.execCommand('copy');
        helper.remove();
      }
      toast('Resultado e link copiados para a área de transferência.', 'success', { title: 'Pronto para compartilhar' });
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      toast('Copie o endereço da página para compartilhar esta conversão.', 'info', { title: 'Compartilhar' });
    }
  }

  /* ==========================================================================
     9. ATALHOS, TEMA E REDE
     ========================================================================== */
  function renderShortcuts() {
    dom.shortcutsList.innerHTML = SHORTCUTS.map((item) => (
      '<div class="keys__row">' +
      '<dt class="keys__keys">' + item.keys.map((key) => '<kbd class="kbd">' + esc(key) + '</kbd>').join('') + '</dt>' +
      '<dd class="keys__desc">' + esc(item.desc) + '</dd>' +
      '</div>'
    )).join('');
  }

  function openShortcuts() {
    if (dom.shortcutsDialog.open) return;
    if (typeof dom.shortcutsDialog.showModal === 'function') dom.shortcutsDialog.showModal();
    else dom.shortcutsDialog.setAttribute('open', '');
  }

  function closeShortcuts() {
    if (dom.shortcutsDialog.open && typeof dom.shortcutsDialog.close === 'function') dom.shortcutsDialog.close();
    else dom.shortcutsDialog.removeAttribute('open');
  }

  function applyTheme(theme, persist) {
    document.documentElement.dataset.theme = theme;
    const isDark = theme === 'dark';
    dom.themeToggle.setAttribute('aria-pressed', String(isDark));
    setText(dom.themeToggleLabel, isDark ? 'Tema escuro ativo' : 'Tema claro ativo');
    dom.themeToggle.title = (isDark ? 'Ativar tema claro' : 'Ativar tema escuro') + ' (T)';
    if (dom.metaThemeColor) dom.metaThemeColor.setAttribute('content', isDark ? '#0a0a14' : '#f4f5fb');
    if (persist) store.set('theme', theme);
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next, true);
    toast(next === 'dark' ? 'Tema escuro ativado.' : 'Tema claro ativado.', 'info', { duration: 2000 });
  }

  function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function bindShortcuts() {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        pickers.from.close();
        pickers.to.close();
        closeShortcuts();
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) {
        if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 's') {
          event.preventDefault();
          swapCurrencies();
        }
        return;
      }

      if (isTypingTarget(event.target)) return;

      const key = event.key.toLowerCase();

      if (key === 's') {
        event.preventDefault();
        swapCurrencies();
      } else if (key === 'c') {
        event.preventDefault();
        copyResult();
      } else if (key === 'r') {
        event.preventDefault();
        refreshRates(true);
      } else if (key === 't') {
        event.preventDefault();
        toggleTheme();
      } else if (key === '/') {
        event.preventDefault();
        pickers.from.open();
      } else if (event.key === '?') {
        event.preventDefault();
        openShortcuts();
      } else if (event.key === 'Enter') {
        /* Enter ativa o controle em foco (botão, link, resumo): não é atalho. */
        const focused = event.target;
        if (focused && focused.closest &&
            focused.closest('button, a, summary, [role="button"], [role="menuitem"], [role="option"]')) {
          return;
        }
        event.preventDefault();
        commitConversion();
      }
    });
  }

  let refreshing = false;

  function refreshRates(force) {
    if (refreshing) return;
    refreshing = true;
    dom.refreshBtn.classList.add('is-spinning');
    dom.marketRefresh.classList.add('is-spinning');
    state.lastSync = null;
    renderSync();

    Promise.all([
      loadRate({ force: true }),
      loadMarket(true)
    ]).then(() => Promise.all([loadSeries(), Promise.resolve()]))
      .then(() => {
        renderRate();
        renderResult({ animate: true });
        renderMarket();
        renderSeries();
        markSynced();
        pickers.from.refresh();
        pickers.to.refresh();
        toast('Cotações atualizadas com sucesso.', 'success', { title: 'Tudo em dia', duration: 2600 });
      })
      .catch(() => {
        toast('Mantivemos os últimos valores disponíveis.', 'error', { title: 'Não foi possível atualizar' });
      })
      .then(() => {
        dom.refreshBtn.classList.remove('is-spinning');
        dom.marketRefresh.classList.remove('is-spinning');
        refreshing = false;
      });
  }

  /* ==========================================================================
     10. INICIALIZAÇÃO
     ========================================================================== */
  function restorePreferences() {
    const fromUrl = readUrl();
    const prefs = store.get('prefs', {}) || {};

    state.from = fromUrl.from || (CURRENCIES[prefs.from] ? prefs.from : 'BRL');
    state.to = fromUrl.to || (CURRENCIES[prefs.to] ? prefs.to : 'USD');
    if (state.from === state.to) state.to = CODES.filter((code) => code !== state.from)[0];

    const amount = Number.isFinite(fromUrl.amount) ? fromUrl.amount
      : (Number.isFinite(prefs.amount) ? prefs.amount : 100);

    state.amount = amount;
    state.amountValid = Number.isFinite(amount) && amount > 0;
    dom.amountInput.value = state.amountValid ? maskAmount(amount, state.from) : '';

    const history = store.get('history', []);
    state.history = Array.isArray(history)
      ? history.filter((item) => item && typeof item.id === 'string' && /^[A-Za-z0-9_-]+$/.test(item.id) &&
        CURRENCIES[item.from] && CURRENCIES[item.to] &&
        Number.isFinite(item.amount) && Number.isFinite(item.result))
      : [];
  }

  function savePreferences() {
    store.set('prefs', { from: state.from, to: state.to, amount: state.amount });
  }

  /** Recarrega cotação e série do par atual e mantém a tela coerente. */
  function reloadPair() {
    Promise.all([loadRate(), loadSeries()]).then(() => {
      setResultPending(false);
      renderRate();
      renderResult({ animate: true });
      renderSeries();
      markSynced();
      savePreferences();
      pickers.from.refresh();
      pickers.to.refresh();
    });
  }

  function bindEvents() {
    dom.amountInput.addEventListener('input', () => liveConvert());

    dom.amountInput.addEventListener('blur', () => {
      const value = parseAmount(dom.amountInput.value);
      if (Number.isFinite(value) && value >= 0) {
        state.amount = value;
        state.amountValid = value > 0;
        dom.amountInput.value = maskAmount(value, state.from);
        renderResult({ animate: false });
      }
      savePreferences();
    });

    dom.amountInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitConversion();
      }
    });

    dom.clearAmount.addEventListener('click', () => {
      dom.amountInput.value = '';
      state.amount = 0;
      state.amountValid = false;
      showAmountError('');
      renderResult({ animate: false });
      updateChips();
      urlSync();
      dom.amountInput.focus();
    });

    dom.form.addEventListener('submit', (event) => {
      event.preventDefault();
      commitConversion();
    });

    $$('.chip', dom.form).forEach((chip) => {
      chip.addEventListener('click', () => {
        const value = Number(chip.dataset.amount);
        dom.amountInput.value = maskAmount(value, state.from);
        state.amount = value;
        state.amountValid = true;
        validateAmount(false);
        renderResult({ animate: true });
        updateChips();
        urlSync();
        savePreferences();
        dom.amountInput.focus();
      });
    });

    dom.swapBtn.addEventListener('click', swapCurrencies);
    dom.copyBtn.addEventListener('click', copyResult);
    dom.shareBtn.addEventListener('click', shareConversion);
    dom.refreshBtn.addEventListener('click', () => refreshRates(true));
    dom.themeToggle.addEventListener('click', toggleTheme);
    dom.shortcutsBtn.addEventListener('click', openShortcuts);
    dom.shortcutsBtnFoot.addEventListener('click', openShortcuts);
    dom.shortcutsClose.addEventListener('click', closeShortcuts);

    dom.shortcutsDialog.addEventListener('click', (event) => {
      if (event.target === dom.shortcutsDialog) closeShortcuts();
    });

    /* Histórico: reutilizar ou remover */
    dom.historyList.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-delete]');
      if (removeButton) {
        state.history = state.history.filter((item) => item.id !== removeButton.dataset.delete);
        saveHistory();
        renderHistory();
        return;
      }

      const loadButton = event.target.closest('[data-id]');
      if (!loadButton) return;

      const item = state.history.filter((entry) => entry.id === loadButton.dataset.id)[0];
      if (!item) return;

      state.from = item.from;
      state.to = item.to;
      state.amount = item.amount;
      state.amountValid = item.amount > 0;
      dom.amountInput.value = maskAmount(item.amount, item.from);
      renderMeta();
      validateAmount(false);
      renderResult({ animate: true });
      updateChips();
      urlSync();
      savePreferences();
      reloadPair();
      toast('Conversão recarregada do histórico.', 'info', { duration: 2200 });
    });

    dom.clearHistory.addEventListener('click', () => {
      if (!state.history.length) return;
      state.history = [];
      saveHistory();
      renderHistory();
      toast('Histórico limpo.', 'info', { duration: 2200 });
    });

    /* Painel de mercado: carrega o par no conversor */
    dom.watchList.addEventListener('click', (event) => {
      if (event.target.closest('#marketRetry')) {
        loadMarket(true).then(() => {
          renderMarket();
          pickers.from.refresh();
          pickers.to.refresh();
        });
        return;
      }

      const button = event.target.closest('[data-code]');
      if (!button) return;

      state.from = button.dataset.code;
      state.to = 'BRL';
      state.amountValid = state.amount > 0;
      renderMeta();
      setResultPending(true);
      updateChips();
      urlSync();
      savePreferences();
      reloadPair();
      announce('Par carregado: ' + CURRENCIES[state.from].name + ' para ' + CURRENCIES[state.to].name);
    });

    dom.marketRefresh.addEventListener('click', () => {
      dom.marketRefresh.classList.add('is-spinning');
      loadMarket(true).then(() => {
        renderMarket();
        pickers.from.refresh();
        pickers.to.refresh();
      }).then(() => {
        dom.marketRefresh.classList.remove('is-spinning');
      });
    });

    /* Rede */
    window.addEventListener('online', () => {
      renderNetwork();
      toast('Conexão restabelecida. Atualizando cotações…', 'success', { duration: 2600 });
      refreshRates(true);
    });

    window.addEventListener('offline', () => {
      renderNetwork();
      toast('Usando as últimas cotações salvas.', 'warn', { title: 'Você está offline' });
    });

    /* Revalidação suave ao voltar para a aba */
    let lastFocus = Date.now();
    window.addEventListener('focus', () => {
      if (Date.now() - lastFocus < 60000 || !navigator.onLine) return;
      lastFocus = Date.now();
      loadRate({ force: true }).then(() => {
        renderRate();
        renderResult({ animate: false });
        markSynced();
      });
    });

    /* Relógio relativo do histórico e do rodapé */
    window.setInterval(() => {
      renderRate();
      renderSync();
      $$('.hist__item', dom.historyList).forEach((node) => {
        const button = node.querySelector('[data-id]');
        if (!button) return;
        const item = state.history.filter((entry) => entry.id === button.dataset.id)[0];
        const time = node.querySelector('.hist__time');
        if (item && time) setText(time, relativeTime(item.at));
      });
    }, 30000);

    window.addEventListener('beforeunload', savePreferences);
  }

  async function init() {
    restorePreferences();
    renderShortcuts();
    renderMeta();
    renderHistory();
    renderNetwork();
    renderSync();
    setText(dom.appVersion, APP_VERSION);
    applyTheme(document.documentElement.dataset.theme || 'dark', false);
    updateChips();
    renderRate();
    setResultPending(true);

    bindEvents();
    bindShortcuts();

    await Promise.all([loadRate(), loadMarket(false)]);

    setResultPending(false);
    renderRate();
    renderResult({ animate: true });
    renderMarket();
    markSynced();
    pickers.from.refresh();
    pickers.to.refresh();

    await loadSeries();
    renderSeries();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
