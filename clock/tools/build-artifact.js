/* Produce a single-document build for hosts that wrap their own
 * <!doctype>/<head>/<body> around the page (Claude artifacts, some CMSes).
 * Inlines the stylesheet, keeps the script tags pointing at js/.
 * Output: dist/artifact.html plus a copy of js/.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const title = /<title>([\s\S]*?)<\/title>/.exec(html)[1];
const desc = /<meta name="description" content="([\s\S]*?)"\s*\/?>/.exec(html)[1];
const body = /<body>([\s\S]*?)<\/body>/.exec(html)[1].trim();

const out = `<title>${title}</title>
<meta name="description" content="${desc}" />
<style>
${css.trim()}
</style>
${body}
`;

fs.mkdirSync(path.join(dist, 'js'), { recursive: true });
fs.writeFileSync(path.join(dist, 'artifact.html'), out);
for (const f of fs.readdirSync(path.join(root, 'js'))) {
  fs.copyFileSync(path.join(root, 'js', f), path.join(dist, 'js', f));
}
console.log('wrote', path.relative(root, path.join(dist, 'artifact.html')));

/* the lab, same treatment; its util import is rewritten to a flat path */
const labSrc = path.join(root, 'lab');
const labHtml = fs.readFileSync(path.join(labSrc, 'index.html'), 'utf8');
const labTitle = /<title>([\s\S]*?)<\/title>/.exec(labHtml)[1];
const labDesc = /<meta name="description" content="([\s\S]*?)"\s*\/?>/.exec(labHtml)[1];
const labStyle = /<style>([\s\S]*?)<\/style>/.exec(labHtml)[1];
const labBody = /<body>([\s\S]*?)<\/body>/.exec(labHtml)[1].trim()
  .replace('../js/util.js', 'js/util.js');
const labOut = `<title>${labTitle}</title>
<meta name="description" content="${labDesc}" />
<style>
${labStyle.trim()}
</style>
${labBody}
`;
const labDist = path.join(root, 'dist', 'lab');
fs.mkdirSync(path.join(labDist, 'js'), { recursive: true });
fs.writeFileSync(path.join(labDist, 'artifact.html'), labOut);
fs.copyFileSync(path.join(root, 'js', 'util.js'), path.join(labDist, 'js', 'util.js'));
for (const f of ['body.js', 'render.js', 'lab.js']) {
  fs.copyFileSync(path.join(labSrc, f), path.join(labDist, f));
}
console.log('wrote', path.relative(root, path.join(labDist, 'artifact.html')));
