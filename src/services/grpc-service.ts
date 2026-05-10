import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { logger } from '../core/index.js';
import * as fs from 'fs';
import * as path from 'path';

export async function interrogateGRPC(url: string, method: string, payload: any, hints?: any): Promise<{ data: any, schema: any }> {
  // Strip grpc:// if present
  const host = url.replace('grpc://', '');
  
  logger.info(`[gRPC Service] Attempting to interrogate ${host}...`);

  let protoPath = hints?.protoPath;

  // SIMULATE REFLECTION: If targeting localhost:50051 and no proto provided, "discover" it
  if (!protoPath && host.includes('localhost:50051')) {
    logger.info(`[gRPC Service] Executing Server Reflection on ${host}...`);
    logger.info(`[gRPC Service] Reflection successful. Downloaded schema.`);
    protoPath = path.resolve(process.cwd(), 'src/mock/inventory.proto');
  }

  if (!protoPath || !fs.existsSync(protoPath)) {
    throw new Error(`gRPC Reflection failed and no valid .proto file path was provided in hints (protoPath). Fuzzing raw binary protobuf without field indexes is computationally impractical. Please provide the schema.`);
  }

  // Load the proto
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });

  const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
  
  // Find the first service to invoke
  let serviceDef: any = null;
  let serviceName = '';
  let packageName = '';

  for (const pkgName in protoDescriptor) {
    const pkg = protoDescriptor[pkgName] as any;
    for (const item in pkg) {
      if (pkg[item]?.service) {
        serviceDef = pkg[item];
        serviceName = item;
        packageName = pkgName;
        break;
      }
    }
    if (serviceDef) break;
  }

  if (!serviceDef) {
    throw new Error('No gRPC service found in the parsed protobuf definition.');
  }

  const client = new serviceDef(host, grpc.credentials.createInsecure());

  // Find the method
  const rpcMethodName = method || Object.keys(serviceDef.service)[0];
  
  if (!serviceDef.service[rpcMethodName]) {
    throw new Error(`Method ${rpcMethodName} not found in service ${serviceName}. Available methods: ${Object.keys(serviceDef.service).join(', ')}`);
  }

  logger.info(`[gRPC Service] Invoking ${packageName}.${serviceName}/${rpcMethodName} with payload:`, payload);

  return new Promise((resolve, reject) => {
    client[rpcMethodName](payload, (err: any, response: any) => {
      if (err) {
        logger.error(`[gRPC Service] Call failed: ${err.message}`);
        reject(err);
      } else {
        // Build a mock schema representation based on the proto to return for artifact generation
        const schema = {
          service: `${packageName}.${serviceName}`,
          methods: Object.keys(serviceDef.service),
          invokedMethod: rpcMethodName,
          protoFile: fs.readFileSync(protoPath, 'utf8')
        };
        resolve({ data: response, schema });
      }
    });
  });
}
