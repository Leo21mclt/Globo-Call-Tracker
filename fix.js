const fs = require('fs');
const path = require('path');

const safeHtmlCode = `
function safeSetHTML(el, htmlString, contextTag) {
  if (contextTag === 'svg') {
    const doc = new DOMParser().parseFromString(htmlString, 'image/svg+xml');
    el.replaceChildren(doc.documentElement);
    return;
  }
  if (contextTag === 'tr') {
    const doc = new DOMParser().parseFromString('<table><tbody><tr>' + htmlString + '</tr></tbody></table>', 'text/html');
    el.replaceChildren(...doc.querySelector('tr').childNodes);
    return;
  }
  if (contextTag === 'table') {
    const doc = new DOMParser().parseFromString('<table>' + htmlString + '</table>', 'text/html');
    el.replaceChildren(...doc.querySelector('table').childNodes);
    return;
  }
  const doc = new DOMParser().parseFromString(htmlString, 'text/html');
  el.replaceChildren(...doc.body.childNodes);
}

`;

const processPopup = () => {
  let p = fs.readFileSync('Firefox/popup/popup.js', 'utf8');
  p = safeHtmlCode + p;
  p = p.replace(/logsBody\.innerHTML = "";/g, 'logsBody.replaceChildren();');
  p = p.replace(/icon\.innerHTML = getTypeIconSvg\(callType\);/g, "safeSetHTML(icon, getTypeIconSvg(callType), 'svg');");
  p = p.replace(/banner\.innerHTML = `Version \$\{data\.updateAvailable\.version\} is available! <a href="\$\{data\.updateAvailable\.url\}" target="_blank">Download here<\/a>`;/g, 'safeSetHTML(banner, `Version ${data.updateAvailable.version} is available! <a href="${data.updateAvailable.url}" target="_blank">Download here</a>`);');
  fs.writeFileSync('Firefox/popup/popup.js', p);
};

const processRecords = () => {
  let r = fs.readFileSync('Firefox/records/records.js', 'utf8');
  r = safeHtmlCode + r;
  r = r.replace(/icon\.innerHTML = getTypeIconSvg\(callType\);/g, "safeSetHTML(icon, getTypeIconSvg(callType), 'svg');");
  r = r.replace(/if \(container\) container\.innerHTML = "";/g, 'if (container) container.replaceChildren();');
  r = r.replace(/table\.innerHTML = `([\s\S]*?)`;/g, "safeSetHTML(table, `$1`, 'table');");
  r = r.replace(/modal\.innerHTML = `([\s\S]*?)`;/g, "safeSetHTML(modal, `$1`);");
  r = r.replace(/content\.innerHTML = '';/g, "content.replaceChildren();");
  r = r.replace(/content\.innerHTML = '<p class="muted">No shifts found to sync\.<\/p>';/g, "safeSetHTML(content, '<p class=\"muted\">No shifts found to sync.</p>');");
  r = r.replace(/weekEl\.innerHTML = `([\s\S]*?)`;/g, "safeSetHTML(weekEl, `$1`);");
  r = r.replace(/row\.innerHTML = `([\s\S]*?)`;/g, "safeSetHTML(row, `$1`, 'tr');");
  r = r.replace(/grid\.innerHTML = '';/g, "grid.replaceChildren();");
  r = r.replace(/block\.innerHTML = `([\s\S]*?)`;/g, "safeSetHTML(block, `$1`);");
  r = r.replace(/container\.innerHTML = '';/g, "container.replaceChildren();");
  r = r.replace(/container\.innerHTML = '<div class="empty">No shifts defined\.<\/div>';/g, "safeSetHTML(container, '<div class=\"empty\">No shifts defined.</div>');");
  r = r.replace(/el\.innerHTML = `([\s\S]*?)`;/g, "safeSetHTML(el, `$1`, 'svg');");
  fs.writeFileSync('Firefox/records/records.js', r);
};

processPopup();
processRecords();
console.log('Done');
