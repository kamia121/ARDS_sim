import fs from 'node:fs/promises';
await fs.rm('dist',{recursive:true,force:true});
await fs.mkdir('dist',{recursive:true});
for(const file of ['index.html','styles.css','src','docs']) await fs.cp(file,`dist/${file}`,{recursive:true});
await fs.mkdir('dist/benchmarks',{recursive:true});
for(const file of await fs.readdir('benchmarks')) if(file.endsWith('.json')) await fs.copyFile(`benchmarks/${file}`,`dist/benchmarks/${file}`);
await fs.writeFile('dist/.nojekyll','');
console.log('Static site built in dist/');
