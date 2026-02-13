import { GoogleGenAI, Type } from "@google/genai";
import { Customer, Sale } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateCollectionMessage = async (customerName: string, amountDue: number, dueDate: string, tone: 'polite' | 'firm' | 'urgent'): Promise<string> => {
  try {
    const toneMap = {
        polite: 'вежливый',
        firm: 'строгий',
        urgent: 'срочный'
    };
    
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Напиши короткое сообщение для WhatsApp клиенту ${customerName} на русском языке.
      Долг: ${amountDue} руб. Дата платежа: ${new Date(dueDate).toLocaleDateString()}.
      Тон: ${toneMap[tone]}.
      Максимум 40 слов. Не используй плейсхолдеры. Подпись: 'Команда InstallMate'.`,
    });
    // FIX: Access the 'text' property directly instead of calling a method.
    return response.text || "Не удалось сгенерировать сообщение.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Ошибка генерации. Проверьте интернет.";
  }
};

export const analyzeCustomerRisk = async (customer: Customer, salesHistory: Sale[]): Promise<{ score: number, reason: string }> => {
  try {
    const historySummary = salesHistory.map(s => ({
      status: s.status,
      total: s.totalAmount,
      missedPayments: s.paymentPlan.filter(p => !p.isPaid && new Date(p.date) < new Date()).length
    }));

    const prompt = `
      Проанализируй кредитный риск клиента на основе истории. Отвечай на русском языке.
      Клиент: ${JSON.stringify(customer)}
      История: ${JSON.stringify(historySummary)}
      
      Верни JSON:
      - score: число 0-100 (100 - надежный, 0 - высокий риск)
      - reason: короткое объяснение на русском.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.INTEGER },
            reason: { type: Type.STRING }
          }
        }
      }
    });

    // FIX: Access the 'text' property directly and handle potential parsing errors.
    const responseText = response.text;
    if (responseText) {
      try {
        const result = JSON.parse(responseText);
        return { score: result.score || 50, reason: result.reason || "Недостаточно данных." };
      } catch (parseError) {
        console.error("Gemini JSON Parse Error:", parseError);
        return { score: 50, reason: "Ошибка обработки ответа." };
      }
    }
    return { score: 50, reason: "Недостаточно данных." };

  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return { score: 50, reason: "Анализ недоступен." };
  }
};

export const suggestProductDescription = async (productName: string): Promise<string> => {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Напиши продающее описание из одного предложения для товара "${productName}" на русском языке.`,
        });
        // FIX: Access the 'text' property directly instead of calling a method.
        return response.text?.trim() || "";
    } catch (e) {
        return "";
    }
}