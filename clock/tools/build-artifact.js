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
