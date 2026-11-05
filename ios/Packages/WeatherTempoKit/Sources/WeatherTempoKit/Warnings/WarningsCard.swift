import SwiftUI

/// MetService watches and warnings for the selected place, under the dashboard header.
/// Each row shows the headline, when it applies and where; tap to read MetService's full
/// text and advice. The feed is CC BY 4.0, hence the credit line.
struct WarningsCard: View {
    let warnings: [WeatherWarning]
    let now: Date
    let timeZone: TimeZone

    @State private var expanded: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(warnings) { w in
                row(w)
                if w.id != warnings.last?.id { Divider().overlay(Theme.separator) }
            }
            Text("Source: MetService")
                .font(.caption2).foregroundStyle(Theme.fade)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(tint.opacity(0.55), lineWidth: 1.5))
    }

    /// The card takes the colour of its most severe alert.
    private var tint: Color { Self.color(warnings.map(\.level).max() ?? .yellow) }

    static func color(_ level: WeatherWarning.Level) -> Color { ThemeRGB.warningFill(level).color }

    private func row(_ w: WeatherWarning) -> some View {
        let open = expanded.contains(w.id)
        return VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    if open { expanded.remove(w.id) } else { expanded.insert(w.id) }
                }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(Self.color(w.level))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(w.headline).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.strong)
                        Text(w.timing(now: now, timeZone: timeZone)).font(.caption.weight(.medium)).foregroundStyle(Theme.text)
                        if !w.areaDescription.isEmpty {
                            Text(w.areaDescription).font(.caption).foregroundStyle(Theme.muted).lineLimit(open ? nil : 1)
                        }
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(w.level.spokenName): \(w.headline). \(w.timing(now: now, timeZone: timeZone)). \(w.areaDescription)")
            .accessibilityHint(open ? "Hides the details" : "Shows the details")

            if open {
                VStack(alignment: .leading, spacing: 6) {
                    Text(w.details.trimmingCharacters(in: .whitespacesAndNewlines))
                        .font(.footnote).foregroundStyle(Theme.text)
                    if let advice = w.instruction?.trimmingCharacters(in: .whitespacesAndNewlines), !advice.isEmpty {
                        Text(advice).font(.footnote).foregroundStyle(Theme.muted)
                    }
                    if let web = w.web {
                        Link("More on metservice.com", destination: web).font(.footnote.weight(.semibold))
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 26)
            }
        }
    }
}
