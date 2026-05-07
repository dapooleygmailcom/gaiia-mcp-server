export class SchemaService {
  /**
   * Extracts a representative schema from JSON data.
   */
  public static extractSchema(data: any): any {
    if (data === null || data === undefined) return null;

    if (Array.isArray(data)) {
      if (data.length === 0) return [];
      return [this.extractSchema(data[0])];
    }

    if (typeof data === 'object') {
      const schema: any = {};
      for (const [key, value] of Object.entries(data)) {
        if (value === null) {
          // HEURISTIC: Guess type based on field name for null values
          if (key.endsWith('_id') || key === 'id') {
            schema[key] = 'number';
          } else if (key.endsWith('_at') || key.endsWith('_date') || key.endsWith('_version')) {
            schema[key] = 'string';
          } else {
            schema[key] = 'unknown'; // Better than 'null'
          }
        } else if (Array.isArray(value)) {
          schema[key] = value.length > 0 ? [this.extractSchema(value[0])] : [];
        } else if (typeof value === 'object') {
          schema[key] = this.extractSchema(value);
        } else {
          const valType = typeof value;
          if (valType === 'string') {
            const isIsoDate = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(value as string);
            const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value as string);
            if (isIsoDate) schema[key] = { type: 'string', format: 'date-time' };
            else if (isDateOnly) schema[key] = { type: 'string', format: 'date' };
            else schema[key] = 'string';
          } else {
            schema[key] = valType;
          }
        }
      }
      return schema;
    }

    return typeof data;
  }

  /**
   * Generates a template payload from a schema with default values.
   */
  public static generateTemplate(schema: any): any {
    if (schema === null) return {};
    if (Array.isArray(schema)) {
      return schema.length > 0 ? [this.generateTemplate(schema[0])] : [];
    }
    if (typeof schema === 'object') {
      const template: any = {};
      for (const [key, typeInfo] of Object.entries(schema)) {
        let type = typeof typeInfo === 'string' ? typeInfo : (typeInfo as any).type;
        let format = typeof typeInfo === 'object' ? (typeInfo as any).format : undefined;

        if (type === 'string') {
          if (format === 'date-time') template[key] = new Date().toISOString();
          else if (format === 'date') template[key] = new Date().toISOString().split('T')[0];
          else template[key] = "example_string";
        }
        else if (type === 'number') template[key] = 1;
        else if (type === 'boolean') template[key] = false;
        else if (Array.isArray(typeInfo)) template[key] = [];
        else if (typeof typeInfo === 'object' && !type) template[key] = this.generateTemplate(typeInfo);
        else if (type === 'null' || type === 'unknown') {
          if (key.endsWith('_id') || key === 'id') {
            template[key] = 1;
          } else if (key.endsWith('_at') || key.endsWith('_date') || key.includes('check_in') || key.includes('check_out')) {
            template[key] = new Date().toISOString();
          } else {
            template[key] = "TYPE_PROBE";
          }
        }
        else template[key] = null;
      }
      return template;
    }
    return null;
  }
}
