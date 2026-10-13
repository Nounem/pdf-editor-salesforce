import { readFile, readdir } from 'node:fs/promises';
import { transformSync } from '@lwc/compiler';
const directory = 'force-app/main/default/lwc';
let count = 0;
for (const name of await readdir(directory)) {
    for (const file of await readdir(`${directory}/${name}`)) {
        if (!/\.(js|html|css)$/.test(file)) continue;
        const result = transformSync(await readFile(`${directory}/${name}/${file}`, 'utf8'), file, { name, namespace: 'c', apiVersion: 67 });
        const errors = (result.warnings || []).filter((warning) => warning.level === 1);
        if (errors.length) throw new Error(JSON.stringify(errors));
        count += 1;
    }
}
console.log(`${count} LWC source files compiled successfully.`);
