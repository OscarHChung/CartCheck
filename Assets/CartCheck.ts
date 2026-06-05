declare function getTime(): number;
declare function getDeltaTime(): number;
declare function print(msg: string): void;
declare const global: any;
declare const vec4: any;

@component
export class CartCheck extends BaseScriptComponent {

    @input productNameText: Text;
    @input herePriceText: Text;
    @input onlinePriceText: Text;
    @input verdictText: Text;
    @input hudCardImage: Image;
    @input hereBlockImage: Image;
    @input onlineBlockImage: Image;
    @input hudCard: SceneObject;

    // API Keys
    @input openaiKey: string;
    @input serpapiKey: string;
    @input claudeKey: string;

    private isScanning: boolean = false;
    private cooldownUntil: number = 0;
    private capturedInStorePrice: number = 0;
    private internetModule: any;
    private cameraModule: any;
    private scanId: number = 0;

    onAwake() {
        print("CartCheck: onAwake");

        // Initialize Spectacles modules
        this.internetModule = require("LensStudio:InternetModule");
        this.cameraModule = require("LensStudio:CameraModule");

        this.createEvent("OnStartEvent").bind(() => this.initialize());

        // Pinch/tap gesture — works on Spectacles via SpectaclesInteractionKit and on touch
        this.createEvent("TapEvent").bind(() => this.tryStartScan("tap"));
    }

    private initialize() {
        this.hudCard.enabled = false;
        print("CartCheck: ready — pinch to scan a product");
    }

    private tryStartScan(source: string) {
        // If HUD is showing OR scan is in progress, dismiss everything
        if (this.hudCard.enabled || this.isScanning) {
            print("CartCheck: " + source + " — dismissing HUD");
            this.dismissAll();
            return;
        }

        const now = getTime();
        if (now < this.cooldownUntil) {
            print("CartCheck: cooldown active");
            return;
        }
        print("CartCheck: " + source + " — starting scan");
        this.startScan();
    }

    private dismissAll() {
        this.isScanning = false;
        this.cooldownUntil = 0;
        this.capturedInStorePrice = 0;
        this.hudCard.enabled = false;
        
        // Clear all text so next scan starts fresh
        this.productNameText.text = "";
        this.herePriceText.text = "";
        this.onlinePriceText.text = "";
        this.verdictText.text = "";
    }

    private startScan() {
        this.scanId++;
        this.isScanning = ;
        this.cooldownUntil = getTime() + 5.0;
        this.showLoading();
        this.runScanPipeline(this.scanId);
    }

    private showLoading() {
        this.hudCard.enabled = ;
        this.productNameText.text = "Scanning...";
        this.herePriceText.text = "$-.--";
        this.onlinePriceText.text = "$-.--";
        this.verdictText.text = "Identifying with AI...";
        this.setCardColor(0.2, 0.2, 0.3, 0.92);
    }

    private async runScanPipeline(myScanId: number) {
        try {
            const base64Image = await this.captureStillImage();
            if (myScanId !== this.scanId) { print("CartCheck: scan " + myScanId + " is stale, aborting"); return; }
            if (!base64Image) { this.showError("Camera failed"); return; }
            print("CartCheck: frame captured, " + base64Image.length + " chars");

            const product = await this.analyzeImage(base64Image);
            if (myScanId !== this.scanId) { print("CartCheck: scan " + myScanId + " is stale, aborting"); return; }
            if (!product || !product.found) { this.showNoProduct(); return; }
            print("CartCheck: product — " + product.brand + " " + product.name);
            this.capturedInStorePrice = product.shelfPrice || 0;

            this.verdictText.text = "Looking up Amazon price...";
            const priceData = await this.lookupAmazonPrice(product);
            if (myScanId !== this.scanId) { print("CartCheck: scan " + myScanId + " is stale, aborting"); return; }
            print("CartCheck: amazon — " + priceData.priceStr);

            this.verdictText.text = "Generating verdict...";
            const verdict = await this.generateVerdict(product, priceData);
            if (myScanId !== this.scanId) { print("CartCheck: scan " + myScanId + " is stale, aborting"); return; }
            print("CartCheck: verdict — " + verdict);

            this.showResult(product, priceData, verdict);
        } catch (e) {
            if (myScanId !== this.scanId) return;
            print("CartCheck error: " + e);
            this.showError("Scan failed");
        }
    }

    // ─── Camera capture using Spectacles high-res still image API ────────────
    // requestImage returns a 3200x2400 high-res frame, ideal for OCR/Vision
    private async captureStillImage(): Promise<string> {
        // Try Spectacles high-res still image first (best for OCR)
        try {
            if (typeof this.cameraModule.createImageRequest === "function") {
                const imageRequest = this.cameraModule.createImageRequest();
                const imageFrame = await this.cameraModule.requestImage(imageRequest);
                print("CartCheck: high-res still image captured");
                return await this.encodeTexture(imageFrame.texture);
            }
        } catch (e) {
            print("CartCheck: requestImage failed, falling back — " + e);
        }

        // Fallback: live camera feed (works in emulator, also on Spectacles)
        try {
            const CameraModuleClass: any = global.CameraModule;
            const request = CameraModuleClass.createCameraRequest();
            request.cameraId = CameraModuleClass.CameraId.Default_Color;
            const cameraTexture = this.cameraModule.requestCamera(request);
            print("CartCheck: live camera requested, warming up...");

            return await new Promise<string>((resolve) => {
                const delay = this.createEvent("DelayedCallbackEvent");
                delay.bind(async () => {
                    const encoded = await this.encodeTexture(cameraTexture);
                    resolve(encoded);
                });
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
                (error: any) => {
                    print("CartCheck encode error: " + error);
                    resolve("");
                },
                2,
                1
            );
        });
    }

    // ─── HTTP helpers using InternetModule (Spectacles native) ───────────────
    private httpPost(url: string, headers: any, body: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const HttpRequest: any = global.RemoteServiceHttpRequest;
            const req = HttpRequest.create();
            req.url = url;
            req.method = HttpRequest.HttpRequestMethod.Post;
            req.body = body;
            for (const key in headers) req.setHeader(key, headers[key]);
            this.internetModule.performHttpRequest(req, (response: any) => {
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    try { resolve(JSON.parse(response.body)); }
                    catch (e) { reject("JSON parse: " + e); }
                } else {
                    reject("HTTP " + response.statusCode + ": " + response.body);
                }
            });
        });
    }

    private httpGet(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const HttpRequest: any = global.RemoteServiceHttpRequest;
            const req = HttpRequest.create();
            req.url = url;
            req.method = HttpRequest.HttpRequestMethod.Get;
            this.internetModule.performHttpRequest(req, (response: any) => {
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    try { resolve(JSON.parse(response.body)); }
                    catch (e) { reject("JSON parse: " + e); }
                } else {
                    reject("HTTP " + response.statusCode + ": " + response.body);
                }
            });
        });
    }

    // ─── Step 1: OpenAI Vision identification + shelf price OCR ──────────────
    private async analyzeImage(base64Image: string): Promise<any> {
        const prompt = 'You are analyzing a photo from AR glasses while shopping. ' +
            'Identify the consumer product the user is looking at. Be AGGRESSIVE with identification — never return "Unknown". ' +
            'If you cannot read the brand clearly, GUESS the most likely brand based on packaging style, colors, design, or product category. ' +
            'If multiple brands could match, pick the most common one. ' +
            'Return ONLY valid JSON with these exact keys: brand, name, size, shelfPrice, found. ' +
            '- found:  if any product is visible, false ONLY for empty rooms/scenery/people. ' +
            '- brand: best guess brand name. NEVER "Unknown". If truly ambiguous, pick the most common brand for that product type (e.g. "Coca-Cola" for cola, "Heinz" for ketchup, "Quaker" for oatmeal). ' +
            '- name: product type (e.g. "Corn Flakes", "Water Bottle"). ' +
            '- size: from packaging (e.g. "18oz"), or "" if not visible. ' +
            '- shelfPrice: number from any price tag visible (e.g. 7.69), or 0 if no tag. ' +
            'Example: {"brand":"General Mills","name":"Cinnamon Toast Crunch","size":"49.5oz","shelfPrice":7.69,"found":} ' +
            'No markdown, no fences, JSON only.';

        const body = JSON.stringify({
            model: "gpt-4o-mini",
            max_tokens: 200,
            messages: [{
                role: "user",
                content: [
                    { type: "image_url", image_url: { url: "data:image/jpeg;base64," + base64Image } },
                    { type: "text", text: prompt }
                ]
            }]
        });

        try {
            const data = await this.httpPost(
                "https://api.openai.com/v1/chat/completions",
                {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + this.openaiKey
                },
                body
            );
            const raw = data.choices[0].message.content.trim();
            const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
            return JSON.parse(cleaned);
        } catch (e) {
            print("CartCheck OpenAI error: " + e);
            return null;
        }
    }

    // ─── Step 2: SerpApi Amazon price — tries multiple queries ───────────────
    private async lookupAmazonPrice(product: any): Promise<any> {
        // Try most specific query first, then progressively broader
        const queries: string[] = [];
        if (product.brand && product.name && product.size) {
            queries.push(product.brand + " " + product.name + " " + product.size);
        }
        if (product.brand && product.name) {
            queries.push(product.brand + " " + product.name);
        }
        if (product.name) {
            queries.push(product.name);
        }

        for (let i = 0; i < queries.length; i++) {
            const q = queries[i];
            print("CartCheck: trying Amazon search — " + q);
            const result = await this.searchAmazon(q);
            if (result.price > 0) {
                print("CartCheck: found on attempt " + (i + 1));
                return result;
            }
        }

        return { price: 0, priceStr: "N/A", isPrime: false, title: "" };
    }

    private async searchAmazon(query: string): Promise<any> {
        const url = "https://serpapi.com/search.json?engine=amazon&amazon_domain=amazon.com&k=" +
            encodeURIComponent(query) + "&api_key=" + this.serpapiKey;

        try {
            const data = await this.httpGet(url);
            
            // Debug: log what we got back
            print("CartCheck: SerpApi keys — " + Object.keys(data).join(", "));
            
            const results = data.organic_results;
            if (!results || results.length === 0) {
                print("CartCheck: organic_results is empty for: " + query);
                return { price: 0, priceStr: "N/A", isPrime: false, title: "" };
            }

            print("CartCheck: got " + results.length + " results");
            
            // Find first result that has any price
            for (let i = 0; i < Math.min(results.length, 5); i++) {
                const item = results[i];
                print("CartCheck: result " + i + " title=" + (item.title || "").substring(0, 50));
                print("CartCheck: result " + i + " price=" + JSON.stringify(item.price) + ", extracted_price=" + item.extracted_price);
                
                const extractedPrice =
                    item.extracted_price ||
                    item.price?.value ||
                    item.price?.extracted ||
                    (typeof item.price === "number" ? item.price : 0) ||
                    0;
                
                const priceStr =
                    item.price_raw ||
                    item.price?.raw ||
                    (typeof item.price === "string" ? item.price : "") ||
                    (extractedPrice > 0 ? "$" + extractedPrice.toFixed(2) : "N/A");
                
                if (extractedPrice > 0) {
                    return {
                        price: extractedPrice,
                        priceStr: priceStr,
                        isPrime: item.prime === ,
                        title: item.title || ""
                    };
                }
            }

            print("CartCheck: no result had a price field");
            return { price: 0, priceStr: "N/A", isPrime: false, title: "" };
        } catch (e) {
            print("CartCheck SerpApi error: " + e);
            return { price: 0, priceStr: "N/A", isPrime: false, title: "" };
        }
    }

    // ─── Step 3: Claude verdict — strict character limit ─────────────────────
    private async generateVerdict(product: any, priceData: any): Promise<string> {
        const hasShelf = this.capturedInStorePrice > 0;
        const hasAmazon = priceData.price > 0;

        let context = "";
        if (hasShelf && hasAmazon) {
            context = "Store: $" + this.capturedInStorePrice.toFixed(2) + ". Amazon: " + priceData.priceStr + ". ";
        } else if (hasAmazon) {
            context = "Store price unknown. Amazon: " + priceData.priceStr + ". ";
        } else if (hasShelf) {
            context = "Store: $" + this.capturedInStorePrice.toFixed(2) + ". Not on Amazon. ";
        } else {
            context = "No prices. ";
        }
        
        const prompt = context +
            "Product: " + product.brand + " " + product.name + ". " +
            "You are giving SHOPPING ADVICE. Tell the user whether to BUY IT HERE, BUY ONLINE, or SKIP. " +
            "Base it on the prices given. If store > Amazon by a lot, say buy online. If close or store cheaper, say buy here. " +
            "Format: action verb + reason. Max 20 words. Hard limit 100 chars. Ensure whatever is said isn't just cut off, but a full, coherent, and helpful sentence." +
            "Examples: 'Buy online — save $50.' or 'Grab it. Fair price.' or 'Skip. Way overpriced.' " +
            "DO NOT describe the product. Give a verdict only.";

        const body = JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 80,
            messages: [{ role: "user", content: prompt }]
        });

        try {
            const data = await this.httpPost(
                "https://api.anthropic.com/v1/messages",
                {
                    "Content-Type": "application/json",
                    "x-api-key": this.claudeKey,
                    "anthropic-version": "2023-06-01"
                },
                body
            );
            let verdict = data.content[0].text.trim();
            if (verdict.length > 110) {
                verdict = verdict.substring(0, 107) + "...";
            }
            return verdict;
        } catch (e) {
            print("CartCheck Claude error: " + e);
            return "Check prices yourself.";
        }
    }

    // ─── UI display ──────────────────────────────────────────────────────────
    private showResult(product: any, priceData: any, verdict: string) {
        const productLabel =
            (product.brand && product.brand !== "Unknown" ? product.brand + " " : "") +
            product.name +
            (product.size ? " " + product.size : "");
        this.productNameText.text = productLabel;

        this.herePriceText.text = this.capturedInStorePrice > 0
            ? "$" + this.capturedInStorePrice.toFixed(2)
            : "Not shown";

        this.onlinePriceText.text = priceData.price > 0
            ? priceData.priceStr + (priceData.isPrime ? " *" : "")
            : priceData.priceStr;

        this.verdictText.text = verdict;

        if (priceData.price <= 0) {
            this.setCardColor(0.4, 0.4, 0.4, 0.92);
        } else if (this.capturedInStorePrice <= 0) {
            this.setCardColor(0.20, 0.45, 0.85, 0.92);
        } else {
            const pct = ((this.capturedInStorePrice - priceData.price) / this.capturedInStorePrice) * 100;
            if (pct >= 20)      this.setCardColor(0.89, 0.18, 0.18, 0.92);
            else if (pct > 0)   this.setCardColor(0.90, 0.60, 0.10, 0.92);
            else                this.setCardColor(0.24, 0.70, 0.24, 0.92);
        }

        this.scheduleDismiss(12.0, this.scanId);
    }

    private showNoProduct() {
        this.productNameText.text = "No product detected";
        this.herePriceText.text = "";
        this.onlinePriceText.text = "";
        this.verdictText.text = "Look at a product and pinch";
        this.setCardColor(0.4, 0.4, 0.4, 0.92);
        this.scheduleDismiss(3.0, this.scanId);
    }

    private showError(msg: string) {
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
            // Only dismiss if this is still the current scan
            if (myScanId !== this.scanId) {
                print("CartCheck: dismiss timer for stale scan " + myScanId + " ignored");
                return;
            }
            this.hudCard.enabled = false;
            this.isScanning = false;
        });
        dismiss.reset(seconds);
    }

    private setCardColor(r: number, g: number, b: number, a: number) {
        if (this.hudCardImage && this.hudCardImage.mainMaterial) {
            this.hudCardImage.mainMaterial.mainPass.baseColor = new vec4(r, g, b, a);
        }
    }
}