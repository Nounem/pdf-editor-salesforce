import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function createDemoPdf() {
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const ink = rgb(.09, .19, .24);
    const muted = rgb(.37, .44, .47);
    const accent = rgb(.73, .31, .18);
    const page = pdf.addPage([595, 760]);
    const text = (value, x, y, size = 12, font = regular, color = ink) => page.drawText(value, { x, y, size, font, color });
    page.drawRectangle({ x: 0, y: 640, width: 595, height: 120, color: rgb(.965, .963, .946) });
    text('ATELIER HORIZON', 42, 716, 11, bold);
    text('Devis de prestation', 42, 676, 29, bold);
    text('DEV-2026-014', 435, 716, 10, bold, accent);
    text('DOCUMENT DE DEMONSTRATION', 42, 617, 9, bold, muted);
    text('Destinataire', 42, 575, 10, bold, muted);
    text('Maison Juniper', 42, 552, 16, bold);
    text('Projet : espace de travail', 42, 532, 11);
    text('Date', 397, 575, 10, bold, muted);
    text('13 octobre 2026', 397, 552, 12);
    page.drawRectangle({ x: 42, y: 463, width: 511, height: 29, color: ink });
    text('PRESTATION', 54, 474, 9, bold, rgb(1, 1, 1));
    text('QTE', 383, 474, 9, bold, rgb(1, 1, 1));
    text('MONTANT HT', 450, 474, 9, bold, rgb(1, 1, 1));
    const rows = [['Diagnostic et cadrage', '1', '450,00 EUR'], ['Conception des supports', '2', '900,00 EUR'], ['Accompagnement au lancement', '1', '350,00 EUR']];
    rows.forEach(([label, quantity, amount], index) => {
        const y = 434 - index * 43;
        text(label, 54, y, 11);
        text(quantity, 389, y, 11);
        text(amount, 454, y, 11);
        page.drawLine({ start: { x: 42, y: y - 15 }, end: { x: 553, y: y - 15 }, thickness: .5, color: rgb(.83, .86, .87) });
    });
    text('TOTAL HT', 361, 296, 11, bold);
    text('1 700,00 EUR', 447, 296, 15, bold, accent);
    text('Votre validation', 42, 246, 11, bold);
    text('Ajoutez ici votre mention et votre tampon.', 42, 226, 10, regular, muted);
    page.drawLine({ start: { x: 42, y: 78 }, end: { x: 553, y: 78 }, thickness: .5, color: rgb(.83, .86, .87) });
    text('Exemple fictif pour la documentation de PDF Editor.', 42, 57, 9, regular, muted);
    text('1 / 2', 525, 57, 9, regular, muted);
    const second = pdf.addPage([595, 760]);
    second.drawText('Conditions de la prestation', { x: 42, y: 690, size: 24, font: bold, color: ink });
    second.drawText('Document fictif. Aucun engagement commercial.', { x: 42, y: 648, size: 12, font: regular, color: muted });
    return pdf.save();
}
