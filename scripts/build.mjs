import fs from 'node:fs/promises';
await fs.rm('dist',{recursive:true,force:true});
await fs.mkdir('dist',{recursive:true});
for(const file of ['index.html','styles.css','theme.css','fonts.css','assets','src']) await fs.cp(file,`dist/${file}`,{recursive:true});
await fs.writeFile('dist/.nojekyll','');
console.log('Static site built in dist/');
