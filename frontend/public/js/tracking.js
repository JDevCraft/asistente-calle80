// Analítica y monitoreo (opt-out). initTracking() es la única puerta que carga proveedores;
// Los IDs son públicos (ver CLAUDE.md), no secretos. Sin banner ni opt-out: el consentimiento es presencial.

// IDs de seguimiento: públicos, visibles en el cliente (no son secretos, a diferencia de toda variable de entorno del repo)
const GA4_ID = 'G-0YE9GH8L7X';
const CLARITY_ID = 'zea1biij2f'; // ID de proyecto de Clarity: público, visible en el cliente
const SENTRY_DSN = 'https://d2116e478076aa595232a53fe40719c5@o4512438471950336.ingest.us.sentry.io/4512438492266496'; // DSN de Sentry: público, no secreto
// Un ID que sigue siendo placeholder no se inyecta: evita mandar basura a los vendors antes de tener los IDs reales
const real = v => v && !/X{4,}|REEMPLAZAR/.test(v);
function reportVital(m){ if (window.gtag) gtag('event', 'web_vital', { metric: m.name, value: Math.round(m.value), id: m.id }); }
export function initTracking(){
  if (real(GA4_ID)){
    const s1 = document.createElement('script'); s1.async = true; s1.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID; s1.dataset.tracking = '1'; document.head.appendChild(s1);
    window.dataLayer = window.dataLayer || []; window.gtag = function(){ dataLayer.push(arguments); };
    gtag('js', new Date()); gtag('config', GA4_ID);
    // web-vitals reporta vía GA4, así que sigue a GA4_ID
    const s2 = document.createElement('script'); s2.src = '/js/vendor/web-vitals.iife.js'; // self-hosted (web-vitals@4.2.4), sin CDN de terceros s2.dataset.tracking = '1';
    s2.onload = () => { webVitals.onCLS(reportVital); webVitals.onINP(reportVital); webVitals.onLCP(reportVital); };
    document.head.appendChild(s2);
  }
  if (real(CLARITY_ID)){
    // Snippet oficial de Clarity (cola window.clarity + tag/<id>), adaptado al estilo de la página
    window.clarity = window.clarity || function(){ (window.clarity.q = window.clarity.q || []).push(arguments); };
    const s4 = document.createElement('script'); s4.async = true; s4.src = 'https://www.clarity.ms/tag/' + CLARITY_ID; s4.dataset.tracking = '1'; document.head.appendChild(s4);
  }
  if (real(SENTRY_DSN)){
    const s3 = document.createElement('script'); s3.src = 'https://browser.sentry-cdn.com/11.12.0/bundle.min.js'; s3.dataset.tracking = '1';
    s3.integrity = 'sha384-fpjRzLWxkdRneAxDGo5pt5gKsjCWYV5ksPD+S1lx80QHBhs6Oe58hf8sKUKubCES'; s3.crossOrigin = 'anonymous';
    // Sin datos personales ni texto de búsqueda en errores: se descarta la petición y los breadcrumbs de red
    s3.onload = () => Sentry.init({ dsn: SENTRY_DSN, sendDefaultPii: false,
      beforeSend(event){ delete event.request; return event; },
      beforeBreadcrumb(b){ if (b.category === 'fetch' || b.category === 'xhr') delete b.data; return b; } });
    document.head.appendChild(s3);
  }
}
