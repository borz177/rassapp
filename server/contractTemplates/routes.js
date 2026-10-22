const multer = require("multer");
const crypto = require("crypto");
const { detectType } = require("./sources");
const { recognizeLayout } = require("./layoutRecognize");
const { dailyLimit } = require("./model");
const { createUsage } = require("./usage");

const registerContractTemplateRoutes = (
  app,
  { pool, auth, checkFeatureAccess, recognize = recognizeLayout },
) => {
  const usage = createUsage(pool);
  const ready = usage.ready;
  const running = new Set();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 8, fields: 2, parts: 10 },
  }).array("files", 8);
  app.post("/api/contract-templates/recognize", auth, async (req, res) => {
    // Общий таймаут API — 30 секунд; многостраничный OCR требует большего времени.
    req.setTimeout(150000);
    res.set("Cache-Control", "no-store");
    if (!["manager", "admin"].includes(req.user.role))
      return res.status(403).json({
        msg: "Создавать личные шаблоны может только владелец аккаунта.",
      });
    const access = await checkFeatureAccess(
      req.user.id,
      "contractTemplates",
    ).catch(() => null);
    if (!access?.allowed)
      return res.status(403).json({
        msg: access?.msg || "Личные шаблоны недоступны на вашем тарифе.",
      });
    if (running.has(req.user.id))
      return res
        .status(409)
        .json({ msg: "Образец уже распознаётся. Дождитесь результата." });
    if (running.size >= 3)
      return res.status(503).json({
        msg: "Сейчас распознаются другие образцы. Повторите через минуту.",
      });
    if (Number(req.headers["content-length"]) > 16 * 1024 * 1024 + 65536)
      return res
        .status(413)
        .json({ msg: "Общий размер файлов — не больше 16 МБ." });
    running.add(req.user.id);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 140000);
    const abort = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", abort);
    try {
      await new Promise((resolve, reject) => {
        const stopped = () =>
          reject(new Error("Загрузка остановлена. Попробуйте ещё раз."));
        controller.signal.addEventListener("abort", stopped, { once: true });
        upload(req, res, (e) => {
          controller.signal.removeEventListener("abort", stopped);
          e ? reject(e) : resolve();
        });
      });
      if (req.body?.consent !== "true")
        return res
          .status(400)
          .json({ msg: "Подтвердите передачу образца на распознавание." });
      if (!req.files?.length)
        return res.status(400).json({ msg: "Добавьте фото, PDF или DOCX." });
      if (req.files.reduce((n, f) => n + f.size, 0) > 16 * 1024 * 1024)
        return res
          .status(413)
          .json({ msg: "Общий размер файлов — не больше 16 МБ." });
      req.files.forEach(detectType);
      const daily = await usage.take(req.user.id);
      if (!daily.ok)
        return res.status(429).json({
          msg: `Сегодня исчерпан лимит распознавания (${dailyLimit()} в день). Можно продолжить вручную или повторить завтра.`,
        });
      const result = await recognize(req.files, controller.signal);
      if (controller.signal.aborted)
        throw new Error(
          "Распознавание заняло слишком долго. Попробуйте загрузить меньше страниц.",
        );
      res.json({
        ...result,
        id: "ct_" + crypto.randomBytes(16).toString("hex"),
        attemptsLeft: dailyLimit()
          ? dailyLimit() - daily.attempts
          : null,
      });
    } catch (e) {
      const msg =
        e instanceof multer.MulterError
          ? "Загрузите до 8 файлов, каждый размером не больше 8 МБ."
          : /[А-Яа-я]/.test(e.message || "")
            ? e.message
            : "Не удалось обработать образец. Попробуйте другой файл или вставьте текст вручную.";
      if (!res.headersSent && !res.destroyed)
        res.status(e instanceof multer.MulterError ? 413 : 400).json({ msg });
      // В журнал не попадают документ, ответ провайдера или реквизиты клиента.
    } finally {
      clearTimeout(timeout);
      res.off("close", abort);
      running.delete(req.user.id);
      req.files = [];
    }
  });
  return { ready };
};
module.exports = { registerContractTemplateRoutes };
