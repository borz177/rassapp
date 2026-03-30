// server/services/whatsapp.js
const axios = require('axios');
const FormData = require('form-data');

async function sendWhatsAppFile(idInstance, apiTokenInstance, phone, fileBuffer, fileName) {
  try {
    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: fileName,
      contentType: 'application/pdf'
    });

    const response = await axios.post(
      `https://api.green-api.com/waInstance${idInstance}/sendFileByUpload/${apiTokenInstance}`,
      formData,
      {
        params: {
          chatId: phone + '@c.us',
          caption: 'Ваш договор прикреплён',
          fileName: fileName
        },
        headers: formData.getHeaders()
      }
    );

    return response.data?.idMessage ? true : false;
  } catch (error) {
    console.error('WhatsApp send error:', error.message);
    return false;
  }
}

module.exports = { sendWhatsAppFile };