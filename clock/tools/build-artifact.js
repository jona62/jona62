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

/* js/ now holds a vendor/ directory as well as the modules, so copy the tree
   rather than assuming every entry is a file. */
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const src = path.join(from, f), dst = path.join(to, f);
    if (fs.statSync(src).isDirectory()) copyTree(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

fs.mkdirSync(path.join(dist, 'js'), { recursive: true });
fs.writeFileSync(path.join(dist, 'artifact.html'), out);
copyTree(path.join(root, 'js'), path.join(dist, 'js'));
console.log('wrote', path.relative(root, path.join(dist, 'artifact.html')));

/* the lab, same treatment; its util import is rewritten to a flat path */
const labSrc = path.join(root, 'lab');
const labHtml = fs.readFileSync(path.join(labSrc, 'index.html'), 'utf8');
const labTitle = /<title>([\s\S]*?)<\/title>/.exec(labHtml)[1];
const labDesc = /<meta name="description" content="([\s\S]*?)"\s*\/?>/.exec(labHtml)[1];
const labStyle = /<style>([\s\S]*?)<\/style>/.exec(labHtml)[1];
const labBody = /<body>([\s\S]*?)<\/body>/.exec(labHtml)[1].trim()
  .replace(/\.\.\/js\//g, 'js/');
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
fs.copyFileSync(path.join(labSrc, 'lab.js'), path.join(labDist, 'lab.js'));
for (const f of ['rig.js', 'draw2d.js', 'figure.js']) {
  fs.copyFileSync(path.join(root, 'js', f), path.join(labDist, 'js', f));
}
console.log('wrote', path.relative(root, path.join(labDist, 'artifact.html')));

/* the 3D lab: three.js is vendored, so everything ships with the page */
const l3 = path.join(root, 'lab3d');
const h3 = fs.readFileSync(path.join(l3, 'index.html'), 'utf8');
const t3 = /<title>([\s\S]*?)<\/title>/.exec(h3)[1];
const d3 = /<meta name="description" content="([\s\S]*?)"\s*\/?>/.exec(h3)[1];
const s3 = /<style>([\s\S]*?)<\/style>/.exec(h3)[1];
const b3 = /<body>([\s\S]*?)<\/body>/.exec(h3)[1].trim().replace(/\.\.\/js\//g, 'js/');
const dist3 = path.join(root, 'dist', 'lab3d');
fs.mkdirSync(path.join(dist3, 'js', 'vendor'), { recursive: true });
fs.writeFileSync(path.join(dist3, 'artifact.html'),
  `<title>${t3}</title>\n<meta name="description" content="${d3}" />\n<style>\n${s3.trim()}\n</style>\n${b3}\n`);
for (const f of ['util.js', 'rig.js', 'skin3d.js']) {
  fs.copyFileSync(path.join(root, 'js', f), path.join(dist3, 'js', f));
}
fs.copyFileSync(path.join(root, 'js', 'vendor', 'three.min.js'),
  path.join(dist3, 'js', 'vendor', 'three.min.js'));
fs.copyFileSync(path.join(l3, 'lab3d.js'), path.join(dist3, 'lab3d.js'));
console.log('wrote', path.relative(root, path.join(dist3, 'artifact.html')));
