import * as http from 'http';

function parseCSV(csvString: string): string[][] {
  return csvString.split(/\r?\n/).filter(line => line.trim().length > 0).map(line => line.split(',').map(s => s.trim()));
}

const server = http.createServer((req, res) => {
  const contentType = req.headers['content-type'] || '';
  const isCSV = req.url?.includes('custom-import') || req.url?.includes('workday');
  
  if (req.method === 'GET' && req.url === '/api/erp/xml-import-with-schema?xsd') {
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="SchemaBackedOrder">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="OrderNumber" type="xs:integer"/>
        <xs:element name="OrderQty" type="xs:integer"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`);
    return;
  }

  if (req.method === 'GET' && req.url === '/api/odata/v4/$metadata') {
    res.writeHead(200, { 'Content-Type': 'application/xml', 'OData-Version': '4.0' });
    res.end(`<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="MockOData" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="Employee">
        <Key><PropertyRef Name="ID" /></Key>
        <Property Name="ID" Type="Edm.Int32" Nullable="false" />
        <Property Name="FirstName" Type="Edm.String" Nullable="false" />
        <Property Name="LastName" Type="Edm.String" Nullable="false" />
        <Property Name="Department" Type="Edm.String" />
      </EntityType>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`);
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  if (isCSV && !contentType.includes('text/csv')) {
    res.writeHead(415, { 'Content-Type': 'text/plain' });
    res.end('Unsupported Media Type. This endpoint only accepts text/csv.');
    return;
  }

  const isXML = req.url?.includes('xml-import');
  if (isXML && !contentType.includes('xml')) {
    res.writeHead(415, { 'Content-Type': 'text/plain' });
    res.end('Unsupported Media Type. This endpoint only accepts application/xml.');
    return;
  }

  const isEDI = req.url?.includes('edi');
  if (isEDI && !contentType.includes('edi-x12')) {
    res.writeHead(415, { 'Content-Type': 'text/plain' });
    res.end('Unsupported Media Type. This endpoint only accepts application/edi-x12.');
    return;
  }


  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    const rows = parseCSV(body);
    if (rows.length === 0) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Empty CSV payload');
      return;
    }

    const headers = rows[0];
    const errors: string[] = [];
    errors.push('Line,Error'); // CSV Error Report Header

    if (req.url === '/api/erp/custom-import') {
      const expectedHeaders = ['Item_Ref_Num', 'Stock_Qty_Pcs', 'Unit_Cost_USD'];
      
      // Check Headers
      for (let i = 0; i < expectedHeaders.length; i++) {
        if (headers[i] !== expectedHeaders[i]) {
          errors.push(`Header,Missing required header '${expectedHeaders[i]}' at column ${i + 1}`);
        }
      }

      // Check Data
      if (errors.length === 1) { // Only if headers are correct
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length !== expectedHeaders.length) {
            errors.push(`${i},Incorrect number of columns`);
            continue;
          }
          if (isNaN(Number(row[1]))) {
            errors.push(`${i},Stock_Qty_Pcs must be a valid number`);
          }
          if (isNaN(Number(row[2]))) {
            errors.push(`${i},Unit_Cost_USD must be a valid number`);
          }
        }
      }

      if (errors.length > 1) {
        res.writeHead(400, { 'Content-Type': 'text/csv' });
        res.end(errors.join('\n'));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'Success', message: `Imported ${rows.length - 1} records` }));
      }

    } else if (req.url === '/api/erp/workday-worker-sync') {
      const expectedHeaders = ['Worker_ID', 'First_Name', 'Last_Name', 'Hire_Date', 'Job_Profile'];
      
      // Check Headers
      for (let i = 0; i < expectedHeaders.length; i++) {
        if (headers[i] !== expectedHeaders[i]) {
          errors.push(`Header,Missing required header '${expectedHeaders[i]}' at column ${i + 1}`);
        }
      }

      // Check Data
      if (errors.length === 1) { // Only if headers are correct
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length !== expectedHeaders.length) {
            errors.push(`${i},Incorrect number of columns`);
            continue;
          }
          if (!row[0]) {
            errors.push(`${i},Worker_ID cannot be empty`);
          }
          if (!Date.parse(row[3])) {
            errors.push(`${i},Hire_Date is not a valid date format`);
          }
        }
      }

      if (errors.length > 1) {
        res.writeHead(400, { 'Content-Type': 'text/csv' });
        res.end(errors.join('\n'));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'Success', message: `Synced ${rows.length - 1} workers` }));
      }

    } else if (req.url === '/api/erp/xml-import-no-schema') {
      if (!body.includes('<SyntheticOrder>')) {
        res.writeHead(400, { 'Content-Type': 'application/xml' });
        res.end('<Error>Missing root element <SyntheticOrder></Error>');
        return;
      }
      if (!body.includes('<Ref>')) {
        res.writeHead(400, { 'Content-Type': 'application/xml' });
        res.end('<Error>Missing required child element <Ref> inside <SyntheticOrder></Error>');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end('<Success>Imported successfully</Success>');

    } else if (req.url === '/api/erp/xml-import-with-schema') {
      if (!body.includes('<SchemaBackedOrder>')) {
        res.writeHead(400, { 'Content-Type': 'application/xml' });
        res.end('<Error>Validation failed: Missing <SchemaBackedOrder>. Schema available at http://localhost:4000/api/erp/xml-import-with-schema?xsd</Error>');
        return;
      }
      if (!body.includes('<OrderNumber>')) {
        res.writeHead(400, { 'Content-Type': 'application/xml' });
        res.end('<Error>Validation failed: Missing <OrderNumber>. Schema available at http://localhost:4000/api/erp/xml-import-with-schema?xsd</Error>');
        return;
      }
      if (!body.includes('<OrderQty>')) {
        res.writeHead(400, { 'Content-Type': 'application/xml' });
        res.end('<Error>Validation failed: Missing <OrderQty>. Schema available at http://localhost:4000/api/erp/xml-import-with-schema?xsd</Error>');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end('<Success>Imported schema backed order</Success>');

    } else if (req.url === '/api/odata/v4/Employees') {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'OData-Version': '4.0' });
        res.end(JSON.stringify({ error: { message: "Invalid JSON. Metadata at http://localhost:4000/api/odata/v4/$metadata" } }));
        return;
      }
      
      if (typeof payload.ID !== 'number') {
        res.writeHead(400, { 'Content-Type': 'application/json', 'OData-Version': '4.0' });
        res.end(JSON.stringify({ error: { message: "Property 'ID' is missing or not an Int32. Metadata at http://localhost:4000/api/odata/v4/$metadata" } }));
        return;
      }
      if (typeof payload.FirstName !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json', 'OData-Version': '4.0' });
        res.end(JSON.stringify({ error: { message: "Property 'FirstName' is missing or not a String. Metadata at http://localhost:4000/api/odata/v4/$metadata" } }));
        return;
      }
      if (typeof payload.LastName !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json', 'OData-Version': '4.0' });
        res.end(JSON.stringify({ error: { message: "Property 'LastName' is missing or not a String. Metadata at http://localhost:4000/api/odata/v4/$metadata" } }));
        return;
      }
      res.writeHead(201, { 'Content-Type': 'application/json', 'OData-Version': '4.0' });
      res.end(JSON.stringify({ ...payload, "@odata.context": "http://localhost:4000/api/odata/v4/$metadata#Employees/$entity" }));

    } else if (req.url === '/api/edi/purchase-orders') {
      const segments = body.split('~').map(s => s.trim()).filter(s => s.length > 0);
      if (segments.length === 0) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing required segment: ISA (Interchange Control Header)');
        return;
      }
      
      const hasISA = segments.some(s => s.startsWith('ISA*'));
      if (!hasISA) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing required segment: ISA (Interchange Control Header)');
        return;
      }

      const hasGS = segments.some(s => s.startsWith('GS*'));
      if (!hasGS) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing required segment: GS (Functional Group Header)');
        return;
      }

      const hasST = segments.some(s => s.startsWith('ST*850*'));
      if (!hasST) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing required segment: ST*850 (Transaction Set Header for Purchase Order)');
        return;
      }

      const hasBEG = segments.some(s => s.startsWith('BEG*'));
      if (!hasBEG) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing required segment: BEG (Beginning Segment for Purchase Order)');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('EDI 850 Processed successfully');

    } else if (req.url === '/api/json-rpc') {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
        return;
      }

      if (payload.jsonrpc !== "2.0") {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request: missing jsonrpc version" }, id: payload.id || null }));
        return;
      }

      if (!payload.method) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request: missing method" }, id: payload.id || null }));
        return;
      }

      if (payload.method !== "subtract") {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32601, message: "Method not found. Try 'subtract'" }, id: payload.id || null }));
        return;
      }

      if (!Array.isArray(payload.params) || payload.params.length !== 2) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid params: requires array of two numbers" }, id: payload.id || null }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: "2.0", result: payload.params[0] - payload.params[1], id: payload.id || null }));

    } else if (req.url === '/api/xml-rpc') {
      if (!body.includes('<methodCall>')) {
        res.writeHead(400, { 'Content-Type': 'text/xml' });
        res.end(`<?xml version="1.0"?>
<methodResponse>
  <fault>
    <value>
      <struct>
        <member>
          <name>faultCode</name>
          <value><int>-32600</int></value>
        </member>
        <member>
          <name>faultString</name>
          <value><string>Invalid Request: missing methodCall</string></value>
        </member>
      </struct>
    </value>
  </fault>
</methodResponse>`);
        return;
      }

      if (!body.includes('<methodName>getStateName</methodName>')) {
        res.writeHead(400, { 'Content-Type': 'text/xml' });
        res.end(`<?xml version="1.0"?>
<methodResponse>
  <fault>
    <value>
      <struct>
        <member>
          <name>faultCode</name>
          <value><int>-32601</int></value>
        </member>
        <member>
          <name>faultString</name>
          <value><string>Method not found. Try 'getStateName'</string></value>
        </member>
      </struct>
    </value>
  </fault>
</methodResponse>`);
        return;
      }

      if (!body.includes('<params>') || !body.includes('<param>')) {
        res.writeHead(400, { 'Content-Type': 'text/xml' });
        res.end(`<?xml version="1.0"?>
<methodResponse>
  <fault>
    <value>
      <struct>
        <member>
          <name>faultCode</name>
          <value><int>-32602</int></value>
        </member>
        <member>
          <name>faultString</name>
          <value><string>Invalid params: requires at least one param</string></value>
        </member>
      </struct>
    </value>
  </fault>
</methodResponse>`);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value><string>South Dakota</string></value>
    </param>
  </params>
</methodResponse>`);

    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
});

const PORT = 4000;
server.listen(PORT, () => {
  console.log(`Mock ERP Server running on port ${PORT}`);
  console.log(`- Synthetic: POST http://localhost:${PORT}/api/erp/custom-import`);
  console.log(`- UAT:       POST http://localhost:${PORT}/api/erp/workday-worker-sync`);
  console.log(`- XML No Schema:   POST http://localhost:${PORT}/api/erp/xml-import-no-schema`);
  console.log(`- XML With Schema: POST http://localhost:${PORT}/api/erp/xml-import-with-schema`);
  console.log(`- OData Synthetic: POST http://localhost:${PORT}/api/odata/v4/Employees`);
  console.log(`- EDI Synthetic:   POST http://localhost:${PORT}/api/edi/purchase-orders`);
  console.log(`- JSON-RPC:        POST http://localhost:${PORT}/api/json-rpc`);
  console.log(`- XML-RPC:         POST http://localhost:${PORT}/api/xml-rpc`);
});
