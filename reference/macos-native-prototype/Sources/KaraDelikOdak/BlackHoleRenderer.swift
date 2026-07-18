import Foundation
import AppKit
import MetalKit
import QuartzCore

/// Renderer'ın her karede overlay denetleyicisinden çektiği görsel durum.
struct VisualParams {
    /// Kara delik merkezi — view koordinatında, sol-üst köşe orijinli, puan (pt).
    var center: CGPoint = .zero
    /// Olay ufku yarıçapı (pt).
    var radius: CGFloat = 0
    /// Genel görünürlük 0→1 (doğuş/kayboluş solmaları).
    var intensity: Double = 0
    /// Mola karartması 0→1 (1 = ekran tamamen siyah).
    var blackout: Double = 0
}

/// Metal ile kara delik + kütle çekimsel merceklenme çizer.
/// Ekran dokusu varsa gerçek içerik bükülür; yoksa stilize moda düşer.
final class BlackHoleRenderer: NSObject, MTKViewDelegate {

    // MSL tarafındaki Uniforms ile alan alan aynı bellek düzeni.
    private struct Uniforms {
        var resolution: SIMD2<Float>
        var center: SIMD2<Float>
        var radius: Float
        var time: Float
        var intensity: Float
        var blackout: Float
        var hasScreen: Float
        var pad: Float
    }

    private let device: MTLDevice
    private let commandQueue: MTLCommandQueue
    private var pipeline: MTLRenderPipelineState?
    private let startTime = CACurrentMediaTime()

    let capturer: ScreenCapturer

    /// Her karede güncel görsel durumu veren kaynak (OverlayController bağlar).
    var paramsProvider: (() -> VisualParams)?

    init?(device: MTLDevice) {
        guard let queue = device.makeCommandQueue() else { return nil }
        self.device = device
        self.commandQueue = queue
        self.capturer = ScreenCapturer(device: device)
        super.init()
        do {
            try buildPipeline()
        } catch {
            NSLog("[KaraDelik] Shader derlenemedi: %@", "\(error)")
            return nil
        }
    }

    private func buildPipeline() throws {
        let library = try device.makeLibrary(source: Self.shaderSource, options: nil)
        let desc = MTLRenderPipelineDescriptor()
        desc.vertexFunction = library.makeFunction(name: "vs_main")
        desc.fragmentFunction = library.makeFunction(name: "fs_main")
        let att = desc.colorAttachments[0]!
        att.pixelFormat = .bgra8Unorm
        // Premultiplied alpha karışımı — dokunmadığımız pikseller şeffaf kalır.
        att.isBlendingEnabled = true
        att.rgbBlendOperation = .add
        att.alphaBlendOperation = .add
        att.sourceRGBBlendFactor = .one
        att.sourceAlphaBlendFactor = .one
        att.destinationRGBBlendFactor = .oneMinusSourceAlpha
        att.destinationAlphaBlendFactor = .oneMinusSourceAlpha
        pipeline = try device.makeRenderPipelineState(descriptor: desc)
    }

    // MARK: - MTKViewDelegate

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard let pipeline,
              let drawable = view.currentDrawable,
              let rpd = view.currentRenderPassDescriptor,
              let commandBuffer = commandQueue.makeCommandBuffer() else { return }

        let params = paramsProvider?() ?? VisualParams()
        let scale = Float(view.window?.backingScaleFactor ?? 2.0)
        let drawableSize = view.drawableSize

        let screenTexture = capturer.currentTexture

        var uniforms = Uniforms(
            resolution: SIMD2(Float(drawableSize.width), Float(drawableSize.height)),
            center: SIMD2(Float(params.center.x) * scale, Float(params.center.y) * scale),
            radius: Float(params.radius) * scale,
            time: Float(CACurrentMediaTime() - startTime),
            intensity: Float(params.intensity),
            blackout: Float(params.blackout),
            hasScreen: screenTexture != nil ? 1.0 : 0.0,
            pad: 0
        )

        guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: rpd) else { return }
        encoder.setRenderPipelineState(pipeline)
        encoder.setFragmentBytes(&uniforms, length: MemoryLayout<Uniforms>.stride, index: 0)
        if let screenTexture {
            encoder.setFragmentTexture(screenTexture, index: 0)
        }
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
        commandBuffer.present(drawable)
        commandBuffer.commit()
    }

    // MARK: - Ekransız test çizimi (--rendertest)

    /// Shader'ı ekransız bir dokuya çizdirip PNG olarak kaydeder.
    /// Ekran dokusu yerine sentetik bir dama tahtası kullanılır; böylece
    /// merceklenme bükülmesi ekran izni olmadan da gözle doğrulanabilir.
    func renderTestPNG(to url: URL, size: CGSize, params: VisualParams) -> Bool {
        guard let pipeline else { return false }
        let w = Int(size.width), h = Int(size.height)

        let targetDesc = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm, width: w, height: h, mipmapped: false)
        targetDesc.usage = [.renderTarget]
        targetDesc.storageMode = .shared
        guard let target = device.makeTexture(descriptor: targetDesc),
              let checker = makeCheckerTexture(width: w, height: h) else { return false }

        var uniforms = Uniforms(
            resolution: SIMD2(Float(w), Float(h)),
            center: SIMD2(Float(params.center.x), Float(params.center.y)),
            radius: Float(params.radius),
            time: 1.7,
            intensity: Float(params.intensity),
            blackout: Float(params.blackout),
            hasScreen: 1.0,
            pad: 0)

        let rpd = MTLRenderPassDescriptor()
        rpd.colorAttachments[0].texture = target
        rpd.colorAttachments[0].loadAction = .clear
        rpd.colorAttachments[0].storeAction = .store
        // Opak koyu gri zemin: alpha=0 bölgeleri bu renkte kalır.
        rpd.colorAttachments[0].clearColor = MTLClearColor(red: 0.35, green: 0.35, blue: 0.38, alpha: 1)

        guard let cmd = commandQueue.makeCommandBuffer(),
              let enc = cmd.makeRenderCommandEncoder(descriptor: rpd) else { return false }
        enc.setRenderPipelineState(pipeline)
        enc.setFragmentBytes(&uniforms, length: MemoryLayout<Uniforms>.stride, index: 0)
        enc.setFragmentTexture(checker, index: 0)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        enc.endEncoding()
        cmd.commit()
        cmd.waitUntilCompleted()

        return writePNG(texture: target, to: url)
    }

    private func makeCheckerTexture(width: Int, height: Int) -> MTLTexture? {
        let desc = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false)
        desc.usage = [.shaderRead]
        desc.storageMode = .shared
        guard let tex = device.makeTexture(descriptor: desc) else { return nil }

        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        for y in 0..<height {
            for x in 0..<width {
                let i = (y * width + x) * 4
                let cell = ((x / 40) + (y / 40)) % 2 == 0
                // "metin satırı" hissi veren yatay çizgiler + dama deseni
                let line = (y % 24) < 3
                let r: UInt8 = line ? 220 : (cell ? 190 : 40)
                let g: UInt8 = line ? 200 : (cell ? 190 : 44)
                let b: UInt8 = line ? 90  : (cell ? 195 : 52)
                pixels[i] = b; pixels[i + 1] = g; pixels[i + 2] = r; pixels[i + 3] = 255
            }
        }
        tex.replace(region: MTLRegionMake2D(0, 0, width, height),
                    mipmapLevel: 0, withBytes: pixels, bytesPerRow: width * 4)
        return tex
    }

    private func writePNG(texture: MTLTexture, to url: URL) -> Bool {
        let w = texture.width, h = texture.height
        var bytes = [UInt8](repeating: 0, count: w * h * 4)
        texture.getBytes(&bytes, bytesPerRow: w * 4,
                         from: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0)
        let info = CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue
        guard let ctx = CGContext(data: &bytes, width: w, height: h,
                                  bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: info),
              let image = ctx.makeImage() else { return false }
        let rep = NSBitmapImageRep(cgImage: image)
        guard let data = rep.representation(using: .png, properties: [:]) else { return false }
        do { try data.write(to: url); return true } catch { return false }
    }

    // MARK: - Shader

    /// Çalışma zamanında derlenen MSL kaynağı — .metallib paketleme derdi yok.
    private static let shaderSource = """
    #include <metal_stdlib>
    using namespace metal;

    struct Uniforms {
        float2 resolution;
        float2 center;
        float  radius;
        float  time;
        float  intensity;
        float  blackout;
        float  hasScreen;
        float  pad;
    };

    struct VSOut {
        float4 pos [[position]];
        float2 uv;
    };

    vertex VSOut vs_main(uint vid [[vertex_id]]) {
        // Tam ekran tek üçgen.
        float2 v[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };
        VSOut o;
        o.pos = float4(v[vid], 0.0, 1.0);
        // NDC (y yukarı) -> doku uzayı (y aşağı, sol-üst orijin)
        o.uv = float2(v[vid].x * 0.5 + 0.5, 1.0 - (v[vid].y * 0.5 + 0.5));
        return o;
    }

    fragment float4 fs_main(VSOut in [[stage_in]],
                            constant Uniforms &u [[buffer(0)]],
                            texture2d<float, access::sample> screenTex [[texture(0)]]) {
        constexpr sampler smp(address::clamp_to_edge, filter::linear);

        // Tam karartma: mola ekranı.
        if (u.blackout >= 0.999) {
            return float4(0.0, 0.0, 0.0, 1.0);
        }

        float2 p = in.uv * u.resolution;
        float2 d = p - u.center;
        float r = max(length(d), 1e-3);
        float rs = max(u.radius, 1.0);

        // Etki alanı dışı: tamamen şeffaf, gerçek ekran görünür.
        float influenceR = rs * 7.0;
        if (r > influenceR && u.blackout <= 0.001) {
            return float4(0.0);
        }

        float2 dir = d / r;
        float ang = atan2(d.y, d.x);

        // --- Kütle çekimsel merceklenme ---
        // Işık sapması ~ 1/r: örnekleme noktası merkeze doğru çekilir,
        // olay ufku çevresinde arka plan halka gibi gerilip bükülür.
        // Etki alanı kenarına doğru bükülme yumuşakça sıfırlanır — böylece
        // efekt gerçek ekrana dikişsiz karışır, sert daire kenarı oluşmaz.
        float edgeFade = 1.0 - smoothstep(influenceR * 0.55, influenceR, r);
        float deflect = (rs * rs * 2.2) / r * edgeFade;
        float pullR = max(r - deflect, rs * 0.25);

        // Kerr benzeri çerçeve sürüklenmesi: uzay-zaman olay ufkuna
        // yaklaştıkça sarmal bükülür ve zamanla yavaşça döner — kara delik
        // "canlı" hisseder. Dönüş hızı ~1/r^2 ile içeri doğru artar.
        float dragStr = pow(rs / max(r, rs), 1.6) * edgeFade;
        float rotAng = 1.5 * dragStr + u.time * 0.4 * dragStr * dragStr;
        float cs = cos(rotAng), sn = sin(rotAng);
        float2 dirS = float2(dir.x * cs - dir.y * sn, dir.x * sn + dir.y * cs);

        float2 suv = clamp((u.center + dirS * pullR) / u.resolution, 0.0, 1.0);

        float3 bg = float3(0.0);
        if (u.hasScreen > 0.5) {
            // Kromatik sapma yalnızca olay ufkuna yakınken belirginleşir;
            // uzaktaki metin/pencereler renk saçaksız kalır.
            float chroma = smoothstep(rs * 3.5, rs * 1.25, r) * 0.06;
            float2 suvR = clamp((u.center + dirS * max(r - deflect * (1.0 + chroma), rs * 0.25)) / u.resolution, 0.0, 1.0);
            float2 suvB = clamp((u.center + dirS * max(r - deflect * (1.0 - chroma), rs * 0.25)) / u.resolution, 0.0, 1.0);
            bg = float3(screenTex.sample(smp, suvR).r,
                        screenTex.sample(smp, suv).g,
                        screenTex.sample(smp, suvB).b);
        }

        // Olay ufkuna yaklaşırken kararma.
        float shade = smoothstep(rs, rs * 1.55, r);

        // Foton halkası + dönen akresyon parıltısı.
        float ring = exp(-pow((r - rs * 1.18) / (rs * 0.16), 2.0));
        float swirl = 0.5 + 0.5 * (sin(ang * 3.0 + u.time * 1.6 - (r / rs) * 2.0)
                                 * sin(ang * 5.0 - u.time * 2.3 + 1.7));
        float3 hot  = float3(1.00, 0.72, 0.35);
        float3 cold = float3(0.45, 0.62, 1.00);
        float3 glow = mix(hot, cold, swirl) * ring * 1.6;

        // Zayıf ikinci dış halka.
        float ring2 = exp(-pow((r - rs * 1.9) / (rs * 0.45), 2.0)) * 0.25;
        glow += mix(cold, hot, swirl) * ring2;

        float3 col;
        float alpha;
        // Bükülmenin piksel cinsinden anlamlılığı -> katmanın opaklığı.
        float warpAmount = clamp(deflect / 2.5, 0.0, 1.0) * edgeFade;
        if (u.hasScreen > 0.5) {
            col = bg * shade + glow;
            alpha = clamp(max(warpAmount, max(ring + ring2, 1.0 - shade)), 0.0, 1.0);
        } else {
            // Stilize mod (ekran izni yoksa): parıltı + çevresel kararma.
            col = glow;
            alpha = clamp(max(ring + ring2, (1.0 - shade) * 0.85), 0.0, 1.0);
        }

        // Olay ufkunun kendisi: yumuşak kenarlı mutlak siyah çekirdek.
        float core = 1.0 - smoothstep(rs - 1.5, rs + 1.5, r);
        col = mix(col, float3(0.0), core);
        alpha = max(alpha, core);

        // Mola geçişi karartması.
        col = mix(col, float3(0.0), u.blackout);
        alpha = max(alpha, u.blackout);

        alpha = clamp(alpha * u.intensity, 0.0, 1.0);
        return float4(col * alpha, alpha); // premultiplied
    }
    """
}
