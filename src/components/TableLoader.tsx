import LoadingSpinner from "./LoadingSpinner";

export default function TableLoader({
    colSpan = 10,
    size = 28,
}: {
    colSpan?: number;
    size?: number;
}) {
    return (
        <tr>
            <td colSpan={colSpan}>
                <LoadingSpinner size={size} />
            </td>
        </tr>
    );
}