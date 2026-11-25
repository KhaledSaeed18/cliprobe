// Prints the escape sequence named by its argument into a pipe, as in issue #42.
const E = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const sequences = {
    decsc: `${E}7saved${E}8`,
    ris: `${E}c`,
    ri: `${E}Mx`,
    charset: `${E}(Bx${E}=`,
    dcs: `${E}P1$r${E}\\x`,
    apc: `${E}_Gf=100${E}\\x`,
    osc104: `${E}]104${BEL}x`,
    c1csi: `${String.fromCharCode(0x9b)}2J`,
    c1osc: `${String.fromCharCode(0x9d)}0;title${BEL}`,
    mixed: `${E}c${E}[2K`,
};
process.stdout.write(`${sequences[process.argv[2]] ?? ''}done\n`);
