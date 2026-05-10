import * as net from 'net';

const PORT = 5000;

const server = net.createServer((socket) => {
  socket.on('data', (data) => {
    const message = data.toString().trim();
    
    // Simulate ISO 8583 Parsing and Validation
    if (!message) {
      socket.write('Error: Empty ISO 8583 payload.\n');
      return;
    }

    // Expecting format for testing: MTI|BITMAP|F3|F4
    const parts = message.split('|');

    if (parts.length < 1 || parts[0] !== '0200') {
      socket.write('Error: Invalid MTI. Expected "0200" for Financial Transaction Request. Format should be MTI|BITMAP|...\n');
      return;
    }

    if (parts.length < 2 || parts[1].length !== 16) {
      socket.write('Error: Invalid Primary Bitmap. Expected 16-character hex string.\n');
      return;
    }

    if (parts.length < 3 || parts[2].length !== 6) {
      socket.write('Error: Invalid Field 3 (Processing Code). Expected 6 digits (e.g. 000000).\n');
      return;
    }

    if (parts.length < 4 || parts[3].length !== 12) {
      socket.write('Error: Invalid Field 4 (Amount). Expected 12 digits (e.g. 000000001000 for $10.00).\n');
      return;
    }

    // Success response
    socket.write('0210|F220000000100000|000000|000000001000|00\n');
  });

  socket.on('error', (err) => {
    console.error('TCP Socket Error:', err);
  });
});

server.listen(PORT, () => {
  console.log(`Mock ISO 8583 TCP Server listening on port ${PORT}`);
});
