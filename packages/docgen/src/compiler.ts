/*
 * Copyright 2020 Spotify AB
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as ts from 'typescript';
import { resolve, join, dirname } from 'path';
import { promisify } from 'util';
import fs from 'fs-extra';
import ApiDocGenerator from './docgen/ApiDocGenerator';
import sortSelector from './docgen/sortSelector';
import TypeLocator from './docgen/TypeLocator';
import ApiDocPrinter from './docgen/ApiDocPrinter';
import TypescriptHighlighter from './docgen/TypescriptHighlighter';
import MarkdownPrinter from './docgen/MarkdownPrinter';

const writeFile = promisify(fs.writeFile);

function loadOptions(path: string): ts.CompilerOptions {
  const config: any = require(path);
  let parent = config.extends as string | undefined;

  if (!parent) {
    return config.compilerOptions;
  }
  if (parent.startsWith('.')) {
    parent = join(dirname(path), parent);
  }

  return { ...loadOptions(parent), ...config.compilerOptions };
}

async function main() {
  const rootDir = resolve(__dirname, '..');
  const srcDir = resolve(rootDir, '..', 'core-api', 'src');
  const entrypoint = resolve(srcDir, 'index.ts');
  const apiRefsDir = resolve(rootDir, 'dist');
  const mkdocsYaml = resolve(apiRefsDir, 'mkdocs.yml');

  process.chdir(rootDir);

  const options = loadOptions('../../../tsconfig.json');

  delete options.moduleResolution;
  options.removeComments = false;
  options.noEmit = true;

  const program = ts.createProgram([entrypoint], options);

  const typeLocator = TypeLocator.fromProgram(program);

  const { apis } = typeLocator.findExportedInstances(
    {
      apis: typeLocator.getExportedType(entrypoint, 'createApiRef'),
    },
    [srcDir],
  );

  const apiDocGenerator = ApiDocGenerator.fromProgram(program, rootDir, srcDir);

  const apiDocs = apis
    .map(api => {
      try {
        return apiDocGenerator.toDoc(api);
      } catch (error) {
        throw new Error(
          `Doc generation failed for API in ${api.source.fileName}, ${error.stack}`,
        );
      }
    })
    .sort(sortSelector(x => x.id));

  const apiDocPrinter = new ApiDocPrinter(
    () => new MarkdownPrinter(new TypescriptHighlighter()),
  );

  fs.ensureDirSync(resolve(apiRefsDir, 'docs'));

  await Promise.all(
    apiDocs.map(apiDoc => {
      const data = apiDocPrinter.print(apiDoc);

      return writeFile(join(apiRefsDir, 'docs', `${apiDoc.name}.md`), data);
    }),
  );

  fs.writeFileSync(
    mkdocsYaml,
    [
      'site_name: api-references',
      'nav:',
      ...apiDocs.map(({ id, name }) => `  - ${id}: '${name}.md'`),
    ].join('\n'),
    'utf8',
  );
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});