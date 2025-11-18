const express = require("express");
const dayjs = require("dayjs");
const router = express.Router();
const { getConnection } = require("../dbManager");
const { authAdmin, requireSuperadmin } = require("../middleware/authAdmin");

const DEADLINE_GROUPS = [
  { key: "codoam30", label: "OAM 30 Ore", pattern: "LOWER(c.code) LIKE 'codoam30%'" },
  { key: "codoam15", label: "OAM 15 Ore", pattern: "LOWER(c.code) LIKE 'codoam15%'" },
  { key: "codoam45", label: "OAM 45 Ore", pattern: "LOWER(c.code) LIKE 'codoam45%'" },
  { key: "cod30", label: "IVASS 30 Ore", pattern: "LOWER(c.code) LIKE 'cod30%'" },
  { key: "cod15", label: "IVASS 15 Ore", pattern: "LOWER(c.code) LIKE 'cod15%'" },
];


router.get("/stats", async (req, res) => {
  try {
    const { db = "forma4", mese } = req.query;
    const now = dayjs();
    const currentMonth = now.month() + 1;
    let selectedMonth = parseInt(mese, 10);
    if (isNaN(selectedMonth) || selectedMonth < 1 || selectedMonth > 12) {
      selectedMonth = currentMonth;
    }
    let selectedYear = now.year();
    if (selectedMonth > currentMonth) {
      selectedYear -= 1;
    }
    const monthStart = dayjs(new Date(selectedYear, selectedMonth - 1, 1));
    const monthEnd = monthStart.endOf("month");
    const rangeStart = monthStart.format("YYYY-MM-DD 00:00:00");
    const rangeEnd = monthEnd.format("YYYY-MM-DD 23:59:59");
    const activeWindowStart = now.subtract(10, "minute").format("YYYY-MM-DD HH:mm:ss");
    const activeWindowEnd = now.format("YYYY-MM-DD HH:mm:ss");

    const conn = await getConnection(db);

    const whereMese = mese ? `AND MONTH(date_inscr) = ${conn.escape(mese)}` : "";

    // 🔸 Filtro dinamico opzionale
    const filtroMese = mese && !isNaN(mese)
      ? `AND MONTH(u.date_inscr) = ${parseInt(mese)}`
      : "";

    // 📊 1️⃣ Iscritti / Itinere / Completati per mese corrente anno
    const [chart] = await conn.query(`
      SELECT 
        LPAD(mesi.mese_num, 2, '0') AS mese_num,
        mesi.mese_nome AS month,
        COUNT(u.idUser) AS iscritti,
        SUM(CASE WHEN u.status = 'inprogress' THEN 1 ELSE 0 END) AS itinere,
        SUM(CASE WHEN u.status = 'completed' THEN 1 ELSE 0 END) AS completati
      FROM (
        SELECT 1 AS mese_num, 'Gen' AS mese_nome UNION ALL
        SELECT 2, 'Feb' UNION ALL
        SELECT 3, 'Mar' UNION ALL
        SELECT 4, 'Apr' UNION ALL
        SELECT 5, 'Mag' UNION ALL
        SELECT 6, 'Giu' UNION ALL
        SELECT 7, 'Lug' UNION ALL
        SELECT 8, 'Ago' UNION ALL
        SELECT 9, 'Set' UNION ALL
        SELECT 10, 'Ott' UNION ALL
        SELECT 11, 'Nov' UNION ALL
        SELECT 12, 'Dic'
      ) mesi
      LEFT JOIN learning_courseuser u
        ON MONTH(u.date_inscr) = mesi.mese_num
        AND YEAR(u.date_inscr) = YEAR(CURDATE()) ${whereMese}
      GROUP BY mesi.mese_num, mesi.mese_nome
      ORDER BY mesi.mese_num;
    `);

    // 🎓 2️⃣ Completati per corso nel mese o anno corrente
    const [corsi] = await conn.query(`
      SELECT 
        c.name AS corso,
        COUNT(u.idUser) AS completati
      FROM learning_courseuser u
      JOIN learning_course c ON c.idCourse = u.idCourse
      WHERE u.status = 'completed'
        AND YEAR(u.date_complete) = YEAR(CURDATE())
        ${filtroMese}
      GROUP BY c.idCourse, c.name
      ORDER BY completati DESC;
    `);

    // ⏰ 3️⃣ Scadenze prossime (entro 15 giorni)
    const [scadenze] = await conn.query(`
  SELECT COUNT(*) AS tot
  FROM learning_courseuser
  WHERE date_expire_validity BETWEEN CURDATE() AND LAST_DAY(CONCAT(YEAR(CURDATE()), '-12-31'));
`);

    const fallbackYearExpr = `YEAR(COALESCE(u.date_expire_validity, u.date_complete, u.date_inscr, CURDATE()))`;
    const deadlineDateExpr = `
      COALESCE(
        DATE(u.date_expire_validity),
        STR_TO_DATE(CONCAT(${fallbackYearExpr}, '-12-31'), '%Y-%m-%d')
      )
    `;
    const completedOnTimeCondition = `
      LOWER(COALESCE(u.status,'')) = 'completed'
      AND u.date_complete IS NOT NULL
      AND DATE(u.date_complete) <= ${deadlineDateExpr}
    `;
    const deadlineSelect = DEADLINE_GROUPS.map(group => `
      SUM(
        CASE
          WHEN ${group.pattern}
            AND NOT (${completedOnTimeCondition})
          THEN 1 ELSE 0
        END
      ) AS \`${group.key}\`
    `).join(",\n");

    let deadlines = [];
    if (deadlineSelect) {
      const [deadlineRows] = await conn.query(`
        SELECT
          ${deadlineSelect}
        FROM learning_courseuser u
        JOIN learning_course c ON c.idCourse = u.idCourse
        WHERE DATE_FORMAT(${deadlineDateExpr}, '%m-%d') = '12-31'
      `);

      const raw = deadlineRows[0] || {};
      deadlines = DEADLINE_GROUPS.map(group => ({
        key: group.key,
        label: group.label,
        count: Number(raw[group.key]) || 0,
      }));
    }

    const [dailyLoginsRaw] = await conn.query(
      `
        SELECT giorno, COUNT(DISTINCT user_id) AS utenti
        FROM (
          SELECT DATE(cu.lastenter) AS giorno, cu.idst AS user_id
          FROM core_user cu
          WHERE cu.lastenter BETWEEN ? AND ?

          UNION ALL

          SELECT DATE(ls.enterTime) AS giorno, ls.idUser AS user_id
          FROM learning_tracksession ls
          WHERE ls.active = 1 AND ls.enterTime BETWEEN ? AND ?

          UNION ALL

          SELECT DATE(ls.lastTime) AS giorno, ls.idUser AS user_id
          FROM learning_tracksession ls
          WHERE ls.active = 1 AND ls.lastTime BETWEEN ? AND ?
        ) attivita
        WHERE giorno IS NOT NULL
        GROUP BY giorno
        ORDER BY giorno
      `,
      [rangeStart, rangeEnd, rangeStart, rangeEnd, rangeStart, rangeEnd]
    );

    const totalsByDay = dailyLoginsRaw.reduce((acc, row) => {
      const key = dayjs(row.giorno).format("YYYY-MM-DD");
      acc[key] = Number(row.utenti) || 0;
      return acc;
    }, {});

    const totalDays = monthEnd.date();
    const dailyLogins = [];
    for (let day = 1; day <= totalDays; day++) {
      const dateObj = monthStart.add(day - 1, "day");
      const iso = dateObj.format("YYYY-MM-DD");
      dailyLogins.push({
        day: iso,
        label: `${String(day).padStart(2, "0")}/${String(selectedMonth).padStart(2, "0")}`,
        count: totalsByDay[iso] || 0,
      });
    }

    const [activeRows] = await conn.query(
      `
        SELECT COUNT(DISTINCT user_id) AS tot
        FROM (
          SELECT cu.idst AS user_id
          FROM core_user cu
          WHERE cu.lastenter BETWEEN ? AND ?

          UNION ALL

          SELECT ls.idUser AS user_id
          FROM learning_tracksession ls
          WHERE ls.active = 1 AND (
            (ls.enterTime BETWEEN ? AND ?)
            OR (ls.lastTime BETWEEN ? AND ?)
          )
        ) online
      `,
      [activeWindowStart, activeWindowEnd, activeWindowStart, activeWindowEnd, activeWindowStart, activeWindowEnd]
    );

    const activeLast10 = Number(activeRows?.[0]?.tot ?? 0);

    res.json({
      success: true,
      chart,
      corsi,
      scadenze: scadenze[0]?.tot || 0,
      deadlines,
      dailyLogins,
      dailyLoginsMonth: {
        month: selectedMonth,
        year: selectedYear,
      },
      activeLast10,
    });
  } catch (err) {
    console.error("❌ Errore /api/admin/stats:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;
