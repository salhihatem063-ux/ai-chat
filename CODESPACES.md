# تشغيل dolphin-llama3 عبر GitHub Codespaces (ذاكرة تصل إلى 32GB)

هذه الطريقة تتيح تشغيل النموذج غير المفلتر `dolphin-llama3` مجانًا (ضمن حصة Codespaces الشهرية).

## الخطوات

1. افتح هذا المستودع على GitHub.
2. اضغط **Code** → **Codespaces** → **Create codespace on main**.
3. اختر جهازًا بـ **8 أنوية / 32GB RAM** (من خيارات Configure machines) — أو 16GB كحد أدنى.
4. انتظر انتهاء الإعداد التلقائي (يثبّت Ollama ويحمّل `dolphin-llama3` تلقائيًا).
5. في الطرفية اكتب:
   ```bash
   npm start
   ```
6. افتح المنفذ **3000** من تبويب **Ports** (اجعله Public إن أردت مشاركة الرابط).

## الإعدادات داخل الموقع

- المزوّد: **Ollama** (أو اكتب `http://localhost:11434/v1`).
- النموذج: `dolphin-llama3`.

## نماذج أخرى يمكن تحميلها

```bash
ollama pull wizardlm-uncensored      # 13B
ollama pull dolphin-mixtral:8x7b
ollama pull dolphin-llama3:70b
```

## ملاحظات مهمة

- **حصة مجانية**: ~120 ساعة-نواة شهريًا. جهاز 8 أنوية = ~15 ساعة تشغيل شهريًا مجانًا.
- **الإيقاف التلقائي**: يتوقف الـ Codespace بعد 30 دقيقة خمول. أوقفه يدويًا لتوفير الحصة.
- **الاستخدام المتواصل/الدائم**: استخدم جهازك المحلي أو خادم GPU بدلًا من ذلك.
