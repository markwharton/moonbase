// A 6502 disassembler: the documented opcodes, each line an address, its bytes and the instruction.
// A byte that is no documented opcode is written as a .byte line, since the code also holds data.

// mnemonic and addressing mode for each opcode, 00 to FF, 16 a line; ??? is no documented opcode
const TABLE = `
BRK imp ORA izx ??? - ??? - ??? - ORA zp ASL zp ??? - PHP imp ORA imm ASL acc ??? - ??? - ORA abs ASL abs ??? -
BPL rel ORA izy ??? - ??? - ??? - ORA zpx ASL zpx ??? - CLC imp ORA aby ??? - ??? - ??? - ORA abx ASL abx ??? -
JSR abs AND izx ??? - ??? - BIT zp AND zp ROL zp ??? - PLP imp AND imm ROL acc ??? - BIT abs AND abs ROL abs ??? -
BMI rel AND izy ??? - ??? - ??? - AND zpx ROL zpx ??? - SEC imp AND aby ??? - ??? - ??? - AND abx ROL abx ??? -
RTI imp EOR izx ??? - ??? - ??? - EOR zp LSR zp ??? - PHA imp EOR imm LSR acc ??? - JMP abs EOR abs LSR abs ??? -
BVC rel EOR izy ??? - ??? - ??? - EOR zpx LSR zpx ??? - CLI imp EOR aby ??? - ??? - ??? - EOR abx LSR abx ??? -
RTS imp ADC izx ??? - ??? - ??? - ADC zp ROR zp ??? - PLA imp ADC imm ROR acc ??? - JMP ind ADC abs ROR abs ??? -
BVS rel ADC izy ??? - ??? - ??? - ADC zpx ROR zpx ??? - SEI imp ADC aby ??? - ??? - ??? - ADC abx ROR abx ??? -
??? - STA izx ??? - ??? - STY zp STA zp STX zp ??? - DEY imp ??? - TXA imp ??? - STY abs STA abs STX abs ??? -
BCC rel STA izy ??? - ??? - STY zpx STA zpx STX zpy ??? - TYA imp STA aby TXS imp ??? - ??? - STA abx ??? - ??? -
LDY imm LDA izx LDX imm ??? - LDY zp LDA zp LDX zp ??? - TAY imp LDA imm TAX imp ??? - LDY abs LDA abs LDX abs ??? -
BCS rel LDA izy ??? - ??? - LDY zpx LDA zpx LDX zpy ??? - CLV imp LDA aby TSX imp ??? - LDY abx LDA abx LDX aby ??? -
CPY imm CMP izx ??? - ??? - CPY zp CMP zp DEC zp ??? - INY imp CMP imm DEX imp ??? - CPY abs CMP abs DEC abs ??? -
BNE rel CMP izy ??? - ??? - ??? - CMP zpx DEC zpx ??? - CLD imp CMP aby ??? - ??? - ??? - CMP abx DEC abx ??? -
CPX imm SBC izx ??? - ??? - CPX zp SBC zp INC zp ??? - INX imp SBC imm NOP imp ??? - CPX abs SBC abs INC abs ??? -
BEQ rel SBC izy ??? - ??? - ??? - SBC zpx INC zpx ??? - SED imp SBC aby ??? - ??? - ??? - SBC abx INC abx ??? -
`.trim().split(/\s+/);
const OPS = [];
for (let i = 0; i < 256; i++) OPS.push({ name: TABLE[i * 2], mode: TABLE[i * 2 + 1] });
const SIZE = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, izx: 2, izy: 2, rel: 2, abs: 3, abx: 3, aby: 3, ind: 3 };

const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');

function operand(mode, bytes, pc) {
  const b = bytes[1], w = bytes[1] | bytes[2] << 8;
  switch (mode) {
    case 'imp': return '';
    case 'acc': return 'A';
    case 'imm': return '#$' + hex(b, 2);
    case 'zp': return '$' + hex(b, 2);
    case 'zpx': return '$' + hex(b, 2) + ',X';
    case 'zpy': return '$' + hex(b, 2) + ',Y';
    case 'izx': return '($' + hex(b, 2) + ',X)';
    case 'izy': return '($' + hex(b, 2) + '),Y';
    case 'rel': return '$' + hex((pc + 2 + (b < 128 ? b : b - 256)) & 0xffff, 4);
    case 'abs': return '$' + hex(w, 4);
    case 'abx': return '$' + hex(w, 4) + ',X';
    case 'aby': return '$' + hex(w, 4) + ',Y';
    case 'ind': return '($' + hex(w, 4) + ')';
  }
}

function disassemble(body, origin) {
  const lines = [];
  for (let at = 0; at < body.length; ) {
    const op = OPS[body[at]], pc = origin + at;
    const size = op.name === '???' ? 1 : SIZE[op.mode];
    if (at + size > body.length || op.name === '???') {
      lines.push(hex(pc, 4) + '  ' + hex(body[at], 2).padEnd(9) + '  .byte $' + hex(body[at], 2));
      at++; continue;
    }
    const bytes = body.subarray(at, at + size);
    lines.push(hex(pc, 4) + '  ' + [...bytes].map(b => hex(b, 2)).join(' ').padEnd(9) + '  ' + (op.name + ' ' + operand(op.mode, bytes, pc)).trim());
    at += size;
  }
  return lines.join('\n') + '\n';
}

export { disassemble, OPS, SIZE, operand, hex };
