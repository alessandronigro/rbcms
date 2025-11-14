
export default function LoadingSpinner({
    size = 24,
    border = 3,
    color = "border-t-blue-600",
}: {
    size?: number;
    border?: number;
    color?: string;
}) {
    return (
        <div className="flex items-center justify-center py-6">
            <div
                className={`animate-spin rounded-full border-gray-300 ${color}`}
                style={{
                    width: size,
                    height: size,
                    borderWidth: border,
                }}
            ></div>
        </div>
    );
}