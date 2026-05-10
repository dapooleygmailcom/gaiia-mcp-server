import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { ReflectionService } from '@grpc/reflection';
import * as path from 'path';

const PROTO_PATH = path.resolve(process.cwd(), 'src/mock/inventory.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const inventoryProto = grpc.loadPackageDefinition(packageDefinition).inventory as any;

const inventoryData: any = {
  '123': { item_id: '123', name: 'Widget', quantity: 10, price: 9.99 }
};

function getItem(call: any, callback: any) {
  const item = inventoryData[call.request.item_id];
  if (item) {
    callback(null, item);
  } else {
    callback({
      code: grpc.status.NOT_FOUND,
      details: 'Item not found'
    });
  }
}

function updateItem(call: any, callback: any) {
  const req = call.request;
  if (!inventoryData[req.item_id]) {
    callback({
      code: grpc.status.NOT_FOUND,
      details: 'Item not found'
    });
    return;
  }
  
  if (req.quantity < 0) {
    callback({
      code: grpc.status.INVALID_ARGUMENT,
      details: 'Quantity cannot be negative'
    });
    return;
  }

  inventoryData[req.item_id].quantity = req.quantity;
  if (req.price > 0) inventoryData[req.item_id].price = req.price;
  
  callback(null, inventoryData[req.item_id]);
}

function main() {
  const server = new grpc.Server();
  server.addService(inventoryProto.InventoryService.service, {
    GetItem: getItem,
    UpdateItem: updateItem
  });

  // Enable Reflection!
  const reflection = new ReflectionService(packageDefinition);
  reflection.addToServer(server);

  const port = '50051';
  server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err: Error | null, boundPort: number) => {
    if (err) {
      console.error(err);
      return;
    }
    server.start();
    console.log(`Mock gRPC Server running on port ${boundPort} with Reflection enabled.`);
  });
}

main();
