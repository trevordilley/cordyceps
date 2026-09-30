// Minimal protobuf inspection for the observed Cursor service envelope, not a model codec.
export function field(number, value) {
  const body = Buffer.from(value), size = [];
  let n = body.length;
  do { const byte = n & 127; n >>>= 7; size.push(byte | (n ? 128 : 0)); } while (n);
  return Buffer.concat([Buffer.from([number * 8 + 2, ...size]), body]);
}
export function fields(bytes) {
  const values = new Map(); let offset = 0;
  function varint() {
    let result = 0, shift = 0;
    while (offset < bytes.length && shift < 35) {
      const byte = bytes[offset++]; result += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return result;
      shift += 7;
    }
    throw Error('Invalid protobuf varint');
  }
  while (offset < bytes.length) {
    const tag = varint(), number = tag >>> 3, wire = tag & 7;
    let value;
    if (wire === 0) value = varint();
    else if (wire === 2) {
      const length = varint();
      if (offset + length > bytes.length) throw Error('Truncated protobuf field');
      value = bytes.subarray(offset, offset + length); offset += length;
    } else throw Error(`Unsupported diagnostic wire type ${wire}`);
    values.set(number, value);
  }
  return values;
}
export function inspectAppend(bytes) {
  const hex = fields(bytes).get(1).toString();
  if (!/^(?:[a-f0-9]{2})+$/i.test(hex)) throw Error('Expected hexadecimal BidiAppend data');
  const message = fields(Buffer.from(hex, 'hex')), run = fields(message.get(1));
  const model = fields(run.get(3)), credentials = fields(model.get(8));
  const action = fields(run.get(2)), userAction = fields(action.get(1)), user = fields(userAction.get(1));
  return {message:'AgentClientMessage.run_request',prompt:user.get(1).toString(),model:model.get(1).toString(),
    providerBaseUrl:credentials.get(2).toString(),providerKey:credentials.get(1).toString(),conversationId:run.get(5).toString()};
}
