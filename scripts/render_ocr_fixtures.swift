import AppKit
import Foundation
let root = CommandLine.arguments[1]
let samples:[String:[String]] = [
 "receipt": ["咖啡生活馆", "消费小票 · 合成测试", "2026-09-10", "咖啡 7.00", "合计 7.00 AUD"],
 "bank": ["银行流水 · 合成测试", "2026-09-10 工资 收入 200.00 AUD 余额 1200.00", "2026-09-11 咖啡 支出 7.00 AUD 余额 1193.00", "2026-09-12 转账 50.00 AUD 余额 1143.00", "2026-09-30 期末余额 1143.00 AUD"],
 "investment": ["投资记录 · 合成测试", "基金名称: 中文基金", "观察日: 2026-09-30", "币种 CNY", "市值 20500.00", "成本 20000.00", "今日收益 60.00", "累计收益 500.00"]
]
for (name, lines) in samples {
 let width=1600, height=120+lines.count*94
 let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:width,pixelsHigh:height,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:width*4,bitsPerPixel:32)!
 NSGraphicsContext.saveGraphicsState()
 NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:bitmap)
 NSColor.white.setFill(); NSRect(x:0,y:0,width:width,height:height).fill()
 for (index,line) in lines.enumerated() {
  let attrs:[NSAttributedString.Key:Any] = [.font:NSFont(name:"PingFang SC",size:42) ?? NSFont.systemFont(ofSize:42),.foregroundColor:NSColor.black]
  (line as NSString).draw(at:NSPoint(x:60,y:height-105-index*94),withAttributes:attrs)
 }
 NSGraphicsContext.restoreGraphicsState()
 try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:"\(root)/\(name).png"))
}
