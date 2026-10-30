import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const protoRoot = process.env.PROTO_ROOT ?? join(root, '..', 'proto');
const out = join(root, 'src', 'gen');
mkdirSync(out, { recursive: true });
execFileSync('protoc', [
  `--plugin=protoc-gen-ts_proto=${join(root, 'node_modules', '.bin', 'protoc-gen-ts_proto')}`,
  `--ts_proto_out=${out}`,
  '--ts_proto_opt=forceLong=string,oneof=unions-value,esModuleInterop=true,importSuffix=.ts,outputServices=false,env=node,outputJsonMethods=false,useOptionals=none',
  `-I${protoRoot}`,
  join(protoRoot, 'ars', 'v1', 'events.proto'),
], { stdio: 'inherit' });
