// server/pdfGenerator.js
const PDFDocument = require('pdfkit');

function generateReceiptPDF(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: 'Договор купли-продажи',
          Author: data.settings.companyName || 'Компания',
          CreationDate: new Date()
        }
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Форматирование чисел
      const formatNum = (val) => {
        return val.toLocaleString('ru-RU', {
          minimumFractionDigits: data.settings.showCents ? 2 : 0,
          maximumFractionDigits: data.settings.showCents ? 2 : 0,
        });
      };

      // ЗАГОЛОВОК
      doc.fontSize(16).font('Helvetica-Bold').text(
        'ДОГОВОР КУПЛИ-ПРОДАЖИ ТОВАРА В РАССРОЧКУ',
        { align: 'center', underline: true }
      );
      doc.moveDown(2);

      // ДАТА ДОГОВОРА
      doc.fontSize(10).font('Helvetica').text(
        `Дата заключения: ${new Date(data.sale.startDate).toLocaleDateString('ru-RU')}`,
        { align: 'right' }
      );
      doc.moveDown();

      // СТОРОНЫ ДОГОВОРА
      doc.fontSize(11).font('Helvetica-Bold').text('1. СТОРОНЫ ДОГОВОРА');
      doc.moveDown(0.5);

      doc.font('Helvetica').fontSize(10);
      doc.text(`Продавец: ${data.settings.companyName || 'Компания'}`);
      if (data.settings.whatsapp?.idInstance) {
        doc.text(`Телефон: +${data.settings.whatsapp.idInstance.slice(0, 11)}`);
      }
      doc.moveDown();

      doc.text(`Покупатель: ${data.customer.name}`);
      doc.text(`Телефон: ${data.customer.phone}`);

      if (data.sale.guarantorName) {
        doc.text(`Поручитель: ${data.sale.guarantorName}`);
        doc.text(`Телефон поручителя: ${data.sale.guarantorPhone}`);
      }
      doc.moveDown();

      // ПРЕДМЕТ ДОГОВОРА
      doc.fontSize(11).font('Helvetica-Bold').text('2. ПРЕДМЕТ ДОГОВОРА');
      doc.moveDown(0.5);

      doc.font('Helvetica').fontSize(10);
      doc.text(`Товар: ${data.sale.productName}`);
      doc.text(`Общая стоимость: ${formatNum(data.sale.totalAmount)} ₽`);
      doc.text(`Срок рассрочки: ${data.sale.installments} месяцев`);
      doc.text(`Первоначальный взнос: ${formatNum(data.sale.downPayment)} ₽`);
      if (data.sale.paymentPlan && data.sale.paymentPlan.length > 0) {
        doc.text(`Ежемесячный платёж: ${formatNum(data.sale.paymentPlan[0].amount)} ₽`);
      }
      doc.moveDown();

      // ТАБЛИЦА ПЛАТЕЖЕЙ
      doc.fontSize(11).font('Helvetica-Bold').text('3. ГРАФИК ПЛАТЕЖЕЙ');
      doc.moveDown(0.5);

      // Заголовки таблицы
      const tableTop = doc.y;
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('№', 50, tableTop);
      doc.text('Дата', 100, tableTop);
      doc.text('Сумма (₽)', 250, tableTop);
      doc.text('Остаток (₽)', 400, tableTop);

      // Линия под заголовками
      doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

      // Данные таблицы
      doc.font('Helvetica').fontSize(9);
      let currentDebt = data.sale.totalAmount - data.sale.downPayment;
      let rowY = tableTop + 25;

      // Сначала оплаченные платежи из плана
      const paidPayments = data.sale.paymentPlan
        ? data.sale.paymentPlan
            .filter(p => p.isPaid)
            .map(p => ({ date: new Date(p.date), amount: p.amount }))
            .sort((a, b) => a.date.getTime() - b.date.getTime())
        : [];

      // Добавляем текущий платёж
      paidPayments.push({
        date: new Date(data.paymentDate),
        amount: data.paymentAmount
      });

      paidPayments.forEach((payment, index) => {
        if (rowY > 750) { // Новая страница если конец
          doc.addPage();
          rowY = 50;
        }

        currentDebt -= payment.amount;
        const displayDebt = Math.max(0, currentDebt);

        doc.text(`${index + 1}`, 50, rowY);
        doc.text(payment.date.toLocaleDateString('ru-RU'), 100, rowY);
        doc.text(formatNum(payment.amount), 250, rowY);
        doc.text(formatNum(displayDebt), 400, rowY);

        rowY += 20;
      });

      // Линия под таблицей
      doc.moveTo(50, rowY).lineTo(550, rowY).stroke();
      doc.moveDown(2);

      // УСЛОВИЯ
      doc.fontSize(10).font('Helvetica').text(
        'Продавец обязуется передать Покупателю товар, а Покупатель обязуется ' +
        'принять и оплатить его в рассрочку на указанных выше условиях.',
        { align: 'justify', width: 500 }
      );
      doc.moveDown(3);

      // ПОДПИСИ
      const signatureY = doc.y + 50;

      // Продавец
      doc.moveTo(50, signatureY).lineTo(200, signatureY).stroke();
      doc.fontSize(9).text('Продавец', 50, signatureY + 5);

      // Покупатель
      doc.moveTo(350, signatureY).lineTo(500, signatureY).stroke();
      doc.fontSize(9).text('Покупатель', 350, signatureY + 5);

      if (data.sale.guarantorName) {
        doc.moveTo(200, signatureY).lineTo(350, signatureY).stroke();
        doc.fontSize(9).text('Поручитель', 200, signatureY + 5);
      }

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { generateReceiptPDF };