// server/whatsapp.js
const axios = require('axios');
const FormData = require('form-data');

async function sendWhatsAppFile(idInstance, apiTokenInstance, phone, fileBuffer, fileName) {
  console.log('🔄 WhatsApp API call:', { idInstance, phone: phone.slice(0, 5) + '...', fileName });

  try {
    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: fileName,
      contentType: 'application/pdf'
    });

    const url = `https://api.green-api.com/waInstance${idInstance}/sendFileByUpload/${apiTokenInstance}`;
    console.log('🌐 Green API URL:', url);

    const response = await axios.post(url, formData, {
      params: {
        chatId: phone + '@c.us',
        caption: 'Ваш договор прикреплён',
        fileName: fileName
      },
      headers: formData.getHeaders()
    });

    console.log('📥 Green API response:', response.status, response.data);
    return response.data?.idMessage ? true : false;

  } catch (error) {
    console.error('❌ WhatsApp error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    return false;
  }
}

module.exports = { sendWhatsAppFile };