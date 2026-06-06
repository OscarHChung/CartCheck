declare function getTime(): number;
declare function getDeltaTime(): number;
declare function print(msg: string): void;
declare const global: any;
declare const vec4: any;
declare const vec3: any;

@component
export class CartCheck extends BaseScriptComponent {

    // ─── Scene Inputs ────────────────────────────────────────────────────────
    @input productNameText: Text;
    @input herePriceText: Text;
    @input onlinePriceText: Text;
    @input verdictText: Text;
    @input hudCardImage: Image;
    @input hereBlockImage: Image;
    @input onlineBlockImage: Image;
    @input hudCard: SceneObject;
    @input shadowImage: Image;  // NEW: optional drop shadow

    // ─── API Keys ────────────────────────────────────────────────────────────
    @input openaiKey: string;
    @input serpapiKey: string;
    @input claudeKey: string;

    // ─── Sounds ──────────────────────────────────────────────────────────────
    @input scanStartSound: AudioComponent;
    @input scanDoneSound: AudioComponent;
    @input dismissSound: AudioComponent;

    // ─── Internal state ──────────────────────────────────────────────────────
    private isScanning: boolean = false;
    private cooldownUntil: number = 0;
    private capturedInStorePrice: number = 0;
    private internetModule: any;
    private cameraModule: any;
    private scanId: number = 0;

    // ─── Animation state ─────────────────────────────────────────────────────
    private animationProgress: number = 0;
    private isAnimating: boolean = false;
    private animationDirection: number = 1;
    private animationDuration: number = 0.45;
    private currentFadeAlpha: number = 0;
    private currentPulseAlpha: number = 1;

    private targetCardColor: { r: number, g: number, b: number, a: number } =
        { r: 0.2, g: 0.2, b: 0.3, a: 0.92 };

    // ─── Loading state ───────────────────────────────────────────────────────
    private isShowingLoading: boolean = false;
    private loadingMessage: string = "";
    private loadingDotTimer: number = 0;
    private loadingDotCount: number = 0;
    private loadingPulseTimer: number = 0;

    // ════════════════════════════════════════════════════════════════════════
    onAwake() {
        print("CartCheck: onAwake");
        this.internetModule = require("LensStudio:InternetModule");
        this.cameraModule = require("LensStudio:CameraModule");

        this.createEvent("OnStartEvent").bind(() => this.initialize());
        this.createEvent("TapEvent").bind(() => this.tryStartScan("tap"));

        this.createEvent("UpdateEvent").bind(() => {
            const dt = getDeltaTime();
            this.updateAnimation(dt);
            this.updateLoadingDots(dt);
            this.updateLoadingPulse(dt);
        });
    }

    private initialize() {
        this.hudCard.enabled = false;
        print("CartCheck: ready — pinch to scan");
    }

    // ════════════════════════════════════════════════════════════════════════
    // SCAN FLOW
    // ════════════════════════════════════════════════════════════════════════

    private tryStartScan(source: string) {
        if (this.hudCard.enabled || this.isScanning) {
            this.dismissAll();
            return;
        }
        const now = getTime();
        if (now < this.cooldownUntil) return;
        this.startScan();
    }

    private dismissAll() {
        this.isScanning = false;
        this.cooldownUntil = 0;
        this.capturedInStorePrice = 0;
        this.stopLoadingMessage();
        this.playSound(this.dismissSound);
        this.startFadeOut();
    }

    private startScan() {
        this.scanId++;
        this.isScanning = ;
        this.cooldownUntil = getTime() + 5.0;
        this.playSound(this.scanStartSound);
        this.showLoading();
        this.runScanPipeline(this.scanId);
    }

    private async runScanPipeline(myScanId: number) {
        try {
            const base64Image = await this.captureStillImage();
            if (myScanId !== this.scanId) return;
            if (!base64Image) { this.showError("Camera failed"); return; }

            this.startLoadingMessage("Identifying product");
            const product = await this.analyzeImage(base64Image);
            if (myScanId !== this.scanId) return;
            if (!product || !product.found) { this.showNoProduct(); return; }
            this.capturedInStorePrice = product.shelfPrice || 0;

            this.startLoadingMessage("Looking up Amazon");
            const priceData = await this.lookupAmazonPrice(product);
            if (myScanId !== this.scanId) return;

            this.startLoadingMessage("Writing verdict");
            const verdict = await this.generateVerdict(product, priceData);
            if (myScanId !== this.scanId) return;

            this.showResult(product, priceData, verdict);
        } catch (e) {
            if (myScanId !== this.scanId) return;
            print("CartCheck error: " + e);
            this.showError("Scan failed");
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // CAMERA
    // ════════════════════════════════════════════════════════════════════════

    private async captureStillImage(): Promise<string> {
        try {
            if (typeof this.cameraModule.createImageRequest === "function") {
                const imageRequest = this.cameraModule.createImageRequest();
                const imageFrame = await this.cameraModule.requestImage(imageRequest);
                return await this.encodeTexture(imageFrame.texture);
            }
        } catch (e) {
            print("CartCheck: requestImage failed, fallback — " + e);
        }
        try {
            const CameraModuleClass: any = global.CameraModule;
            const request = CameraModuleClass.createCameraRequest();
            request.cameraId = CameraModuleClass.CameraId.Default_Color;
            const cameraTexture = this.cameraModule.requestCamera(request);
            return await new Promise<string>((resolve) => {
                const delay = this.createEvent("DelayedCallbackEvent");
                delay.bind(async () => resolve(await this.encodeTexture(cameraTexture)));
                delay.reset(0.5);
            });
        } catch (e) {
            print("CartCheck capture error: " + e);
            return "";
        }
    }

    private encodeTexture(texture: any): Promise<string> {
        return new Promise<string>((resolve) => {
            global.Base64.encodeTextureAsync(
                texture,
                (encoded: string) => resolve(encoded),
                (error: any) => { print("CartCheck encode error: " + error); resolve(""); },
                2, 1
            );
        });
    }

    // ════════════════════════════════════════════════════════════════════════
    // HTTP
    // ════════════════════════════════════════════════════════════════════════

    private httpPost(url: string, headers: any, body: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const HttpRequest: any = global.RemoteServiceHttpRequest;
            const req = HttpRequest.create();
            req.url = url; req.method = HttpRequest.HttpRequestMethod.Post; req.body = body;
            for (const k in headers) req.setHeader(k, headers[k]);
            this.internetModule.performHttpRequest(req, (response: any) => {
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    try { resolve(JSON.parse(response.body)); } catch (e) { reject("JSON parse: " + e); }
                } else reject("HTTP " + response.statusCode + ": " + response.body);
            });
        });
    }

    private httpGet(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const HttpRequest: any = global.RemoteServiceHttpRequest;
            const req = HttpRequest.create();
            req.url = url; req.method = HttpRequest.HttpRequestMethod.Get;
            this.internetModule.performHttpRequest(req, (response: any) => {
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    try { resolve(JSON.parse(response.body)); } catch (e) { reject("JSON parse: " + e); }
                } else reject("HTTP " + response.statusCode + ": " + response.body);
            });
        });
    }

    // ════════════════════════════════════════════════════════════════════════
    // APIs (unchanged from before)
    // ════════════════════════════════════════════════════════════════════════

    private async analyzeImage(base64Image: string): Promise<any> {
        const prompt = 'You are analyzing a photo from AR glasses while shopping. ' +
            'Identify the consumer product. Be AGGRESSIVE — never return "Unknown" for brand. ' +
            'If brand unclear, GUESS based on packaging or category. ' +
            'BUT: be CONSERVATIVE about shelfPrice. ONLY return a price number if you can CLEARLY read an actual price tag, shelf label, or sticker with a dollar amount in the image. ' +
            'If no price tag is visible in the image, shelfPrice MUST be 0. ' +
            'DO NOT guess, estimate, or invent a price. DO NOT use the product\'s typical retail price. shelfPrice is ONLY for prices physically readable in the photo. ' +
            'Return ONLY valid JSON with keys: brand, name, size, shelfPrice, found. ' +
            '- found:  if any product visible, false only for empty rooms/scenery. ' +
            '- brand: best guess, NEVER "Unknown". ' +
            '- name: product type (e.g. "Corn Flakes"). ' +
            '- size: from packaging or "". ' +
            '- shelfPrice: ONLY a number you can read from a visible price tag, otherwise 0. ' +
            'Examples: ' +
            '{"brand":"General Mills","name":"Cinnamon Toast Crunch","size":"49.5oz","shelfPrice":7.69,"found":} (price tag was visible) ' +
            '{"brand":"Apple","name":"MacBook Air","size":"15-inch","shelfPrice":0,"found":} (no price tag in frame) ' +
            'JSON only, no markdown.';

        const body = JSON.stringify({
            model: "gpt-4o-mini", max_tokens: 200,
            messages: [{ role: "user", content: [
                { type: "image_url", image_url: { url: "data:image/jpeg;base64," + base64Image } },
                { type: "text", text: prompt }
            ]}]
        });

        try {
            const data = await this.httpPost("https://api.openai.com/v1/chat/completions",
                { "Content-Type": "application/json", "Authorization": "Bearer " + this.openaiKey }, body);
            const raw = data.choices[0].message.content.trim();
            const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
            return JSON.parse(cleaned);
        } catch (e) {
            print("CartCheck OpenAI error: " + e);
            return null;
        }
    }

    private async lookupAmazonPrice(product: any): Promise<any> {
        const queries: string[] = [];
        if (product.brand && product.name && product.size) queries.push(product.brand + " " + product.name + " " + product.size);
        if (product.brand && product.name) queries.push(product.brand + " " + product.name);
        if (product.name) queries.push(product.name);
        for (let i = 0; i < queries.length; i++) {
            const r = await this.searchAmazon(queries[i]);
            if (r.price > 0) return r;
        }
        return { price: 0, priceStr: "N/A", isPrime: false, title: "" };
    }

    private async searchAmazon(query: string): Promise<any> {
        const url = "https://serpapi.com/search.json?engine=amazon&amazon_domain=amazon.com&k=" +
            encodeURIComponent(query) + "&api_key=" + this.serpapiKey;
        try {
            const data = await this.httpGet(url);
            const results = data.organic_results;
            if (!results || results.length === 0) return { price: 0, priceStr: "N/A", isPrime: false, title: "" };
            for (let i = 0; i < Math.min(results.length, 5); i++) {
                const item = results[i];
                const p = item.extracted_price || item.price?.value || item.price?.extracted ||
                    (typeof item.price === "number" ? item.price : 0) || 0;
                const ps = item.price_raw || item.price?.raw ||
                    (typeof item.price === "string" ? item.price : "") ||
                    (p > 0 ? "$" + p.toFixed(2) : "N/A");
                if (p > 0) return { price: p, priceStr: ps, isPrime: item.prime === , title: item.title || "" };
            }
            return { price: 0, priceStr: "N/A", isPrime: false, title: "" };
        } catch (e) {
            print("CartCheck SerpApi error: " + e);
            return { price: 0, priceStr: "N/A", isPrime: false, title: "" };
        }
    }

    private async generateVerdict(product: any, priceData: any): Promise<string> {
        const hasShelf = this.capturedInStorePrice > 0;
        const hasAmazon = priceData.price > 0;
        let context = "";
        if (hasShelf && hasAmazon) context = "Store: $" + this.capturedInStorePrice.toFixed(2) + ". Amazon: " + priceData.priceStr + ". ";
        else if (hasAmazon) context = "Store price unknown. Amazon: " + priceData.priceStr + ". ";
        else if (hasShelf) context = "Store: $" + this.capturedInStorePrice.toFixed(2) + ". Not on Amazon. ";
        else context = "No prices. ";

        const prompt = context + "Product: " + product.brand + " " + product.name + ". " +
            "Give shopping advice: BUY HERE, BUY ONLINE, or SKIP. " +
            "Action verb + reason. Max 15 words. Hard limit 90 chars. Complete sentence. " +
            "Examples: 'Buy online — save $50.' / 'Grab it. Fair price.' / 'Skip. Way overpriced.'";

        const body = JSON.stringify({
            model: "claude-haiku-4-5-20251001", max_tokens: 80,
            messages: [{ role: "user", content: prompt }]
        });

        try {
            const data = await this.httpPost("https://api.anthropic.com/v1/messages",
                { "Content-Type": "application/json", "x-api-key": this.claudeKey, "anthropic-version": "2023-06-01" }, body);
            let verdict = data.content[0].text.trim();
            if (verdict.length > 100) verdict = verdict.substring(0, 97) + "...";
            return verdict;
        } catch (e) {
            print("CartCheck Claude error: " + e);
            return "Check prices yourself.";
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // UI STATES
    // ════════════════════════════════════════════════════════════════════════

    private showLoading() {
        this.hudCard.enabled = ;
        this.productNameText.text = "Scanning";
        this.herePriceText.text = "$-.--";
        this.onlinePriceText.text = "$-.--";
        this.setCardColor(0.2, 0.2, 0.3, 0.92);
        this.startLoadingMessage("Reading product");
        this.startFadeIn();
    }

    private showResult(product: any, priceData: any, verdict: string) {
        this.stopLoadingMessage();
        this.playSound(this.scanDoneSound);

        const label = (product.brand && product.brand !== "Unknown" ? product.brand + " " : "") +
            product.name + (product.size ? " " + product.size : "");
        this.productNameText.text = label;
        this.herePriceText.text = this.capturedInStorePrice > 0 ? "$" + this.capturedInStorePrice.toFixed(2) : "N/A";
        this.onlinePriceText.text = priceData.price > 0 ? priceData.priceStr + (priceData.isPrime ? " *" : "") : priceData.priceStr;
        this.verdictText.text = verdict;

        if (priceData.price <= 0) this.setCardColor(0.4, 0.4, 0.4, 0.92);
        else if (this.capturedInStorePrice <= 0) this.setCardColor(0.20, 0.45, 0.85, 0.92);
        else {
            const pct = ((this.capturedInStorePrice - priceData.price) / this.capturedInStorePrice) * 100;
            if (pct >= 20)      this.setCardColor(0.89, 0.18, 0.18, 0.92);
            else if (pct > 0)   this.setCardColor(0.90, 0.60, 0.10, 0.92);
            else                this.setCardColor(0.24, 0.70, 0.24, 0.92);
        }
        this.scheduleDismiss(12.0, this.scanId);
    }

    private showNoProduct() {
        this.stopLoadingMessage();
        this.productNameText.text = "No product detected";
        this.herePriceText.text = "";
        this.onlinePriceText.text = "";
        this.verdictText.text = "Look at a product and pinch";
        this.setCardColor(0.4, 0.4, 0.4, 0.92);
        this.scheduleDismiss(3.0, this.scanId);
    }

    private showError(msg: string) {
        this.stopLoadingMessage();
        this.productNameText.text = msg;
        this.herePriceText.text = "";
        this.onlinePriceText.text = "";
        this.verdictText.text = "Pinch to retry";
        this.setCardColor(0.89, 0.18, 0.18, 0.92);
        this.scheduleDismiss(3.0, this.scanId);
    }

    private scheduleDismiss(seconds: number, myScanId: number) {
        const dismiss = this.createEvent("DelayedCallbackEvent");
        dismiss.bind(() => {
            if (myScanId !== this.scanId) return;
            this.playSound(this.dismissSound);
            this.startFadeOut();
            this.isScanning = false;
        });
        dismiss.reset(seconds);
    }

    // ════════════════════════════════════════════════════════════════════════
    // ANIMATION — fade-in with overshoot bounce, fade-out smooth
    // ════════════════════════════════════════════════════════════════════════

    private startFadeIn() {
        this.animationProgress = 0;
        this.animationDirection = 1;
        this.isAnimating = ;
    }

    private startFadeOut() {
        this.animationProgress = 1;
        this.animationDirection = -1;
        this.isAnimating = ;
    }

    // easeOutBack — overshoots then settles, creates a "bounce" feel
    private easeOutBack(t: number): number {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }

    // easeOutCubic — smooth, snappy
    private easeOutCubic(t: number): number {
        return 1 - Math.pow(1 - t, 3);
    }

    private updateAnimation(dt: number) {
        if (!this.isAnimating) return;

        this.animationProgress += (dt / this.animationDuration) * this.animationDirection;
        this.animationProgress = Math.max(0, Math.min(1, this.animationProgress));

        // Bouncy easeOutBack for fade-IN, smooth easeOutCubic for fade-OUT
        const eased = this.animationDirection > 0
            ? this.easeOutBack(this.animationProgress)
            : this.easeOutCubic(this.animationProgress);

        this.currentFadeAlpha = eased;
        this.applyCombinedAlpha();

        const done = (this.animationDirection > 0 && this.animationProgress >= 1) ||
                     (this.animationDirection < 0 && this.animationProgress <= 0);
        if (done) {
            this.isAnimating = false;
            if (this.animationDirection < 0) this.hudCard.enabled = false;
        }
    }

    private setCardColor(r: number, g: number, b: number, a: number) {
        this.targetCardColor = { r, g, b, a };
        this.applyCombinedAlpha();
    }

    // ════════════════════════════════════════════════════════════════════════
    // LOADING PULSE — subtle breathing during loading state
    // ════════════════════════════════════════════════════════════════════════

    private updateLoadingPulse(dt: number) {
        if (this.isShowingLoading) {
            this.loadingPulseTimer += dt;
            // Sine wave: smooth oscillation between 0.85 and 1.0
            this.currentPulseAlpha = 0.85 + 0.15 * (0.5 + 0.5 * Math.sin(this.loadingPulseTimer * 4));
            this.applyCombinedAlpha();
        } else if (this.currentPulseAlpha !== 1) {
            // Smoothly return to full when loading ends
            this.currentPulseAlpha = Math.min(1, this.currentPulseAlpha + dt * 2);
            this.applyCombinedAlpha();
        }
    }

    // Combines fade-in/out alpha with loading pulse alpha and writes to materials
    private applyCombinedAlpha() {
        const multiplier = this.currentFadeAlpha * this.currentPulseAlpha;
        const t = this.targetCardColor;

        if (this.hudCardImage?.mainMaterial?.mainPass) {
            this.hudCardImage.mainMaterial.mainPass.baseColor =
                new vec4(t.r, t.g, t.b, t.a * multiplier);
        }

        // Drop shadow follows the same alpha curve but with its own base alpha
        if (this.shadowImage?.mainMaterial?.mainPass) {
            const shadowAlpha = 0.45 * multiplier; // shadow is darker, more translucent
            this.shadowImage.mainMaterial.mainPass.baseColor =
                new vec4(0, 0, 0, shadowAlpha);
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // LOADING DOTS
    // ════════════════════════════════════════════════════════════════════════

    private startLoadingMessage(message: string) {
        this.loadingMessage = message;
        this.loadingDotCount = 0;
        this.loadingDotTimer = 0;
        this.loadingPulseTimer = 0;
        this.isShowingLoading = ;
        this.verdictText.text = message;
    }

    private stopLoadingMessage() {
        this.isShowingLoading = false;
    }

    private updateLoadingDots(dt: number) {
        if (!this.isShowingLoading) return;
        this.loadingDotTimer += dt;
        if (this.loadingDotTimer >= 0.4) {
            this.loadingDotTimer = 0;
            this.loadingDotCount = (this.loadingDotCount + 1) % 4;
            this.verdictText.text = this.loadingMessage + ".".repeat(this.loadingDotCount);
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    private playSound(audio: AudioComponent) {
        if (audio) {
            try { audio.play(1); } catch (e) { print("sound error: " + e); }
        }
    }
}