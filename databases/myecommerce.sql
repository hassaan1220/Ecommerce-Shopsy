-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Aug 29, 2025 at 12:05 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.0.30

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `myecommerce`
--

-- --------------------------------------------------------

--
-- Table structure for table `products`
--

CREATE TABLE `products` (
  `product_id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `price` decimal(10,2) NOT NULL,
  `stock` int(11) NOT NULL DEFAULT 0,
  `image_url` varchar(500) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `products`
--

INSERT INTO `products` (`product_id`, `name`, `description`, `price`, `stock`, `image_url`, `created_at`, `updated_at`) VALUES
(1, 'Jeans', 'Classic slim-fit blue denim jeans, comfortable and durable.', 49.99, 100, '/uploads/jeans.jpg', '2025-08-28 20:21:13', '2025-08-28 20:21:13'),
(7, 'White Casual T-Shirt', 'Classic white cotton T-shirt, perfect for casual wear with a relaxed fit.', 24.99, 150, '/uploads/tshirt.jpg', '2025-08-28 20:42:20', '2025-08-28 20:42:20'),
(8, 'Olive Green Cargo Pants', 'Comfortable and durable cargo pants with multiple utility pockets. Made with breathable cotton blend fabric, perfect for casual and outdoor wear.', 39.99, 100, '/uploads/cargo.jpg', '2025-08-28 20:48:33', '2025-08-28 20:48:33'),
(9, 'Classic Blue Denim Jacket', 'A timeless classic denim jacket with a slim-fit design. Features front button closure, side pockets, and durable stitching. Perfect for layering over any outfit for a casual yet stylish look.', 59.99, 75, '/uploads/denimjacket.jpg', '2025-08-28 21:02:16', '2025-08-28 21:02:16');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `first_name` varchar(100) NOT NULL,
  `last_name` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('customer','admin','vendor') DEFAULT 'customer',
  `status` enum('active','inactive','banned') DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `first_name`, `last_name`, `email`, `password`, `role`, `status`, `created_at`, `updated_at`) VALUES
(1, 'hassaan', 'naqvi', 'hassaannaqvi2@gmail.com', '$2b$10$4RCeouaLYiUdrB2jJeSQaeTiA6JpxQRzwnZuVEcAZINpR03gUf38u', 'customer', 'active', '2025-08-18 22:00:57', '2025-08-23 21:35:50'),
(2, 'peter', 'sutherland', 'petersutherland21@gmail.com', '$2b$10$HEnQy7T8YBf6CArYMnBkn.ko6xcAgPvyuV/MNIzjB5dE07ts0OnR6', 'customer', 'active', '2025-08-18 22:27:09', '2025-08-18 22:27:09'),
(3, 'hussain', 'raza', 'hussain21@gmail.com', '$2b$10$QyQWvv6n18JgFKk90FYSje6KBHhGbcZeMnZar0kj2CF56hTW0jbUW', 'customer', 'active', '2025-08-21 21:09:58', '2025-08-21 21:09:58'),
(4, 'Muhammad', 'Riaz', 'khixerriaz19@gmail.com', '$2b$10$hlJhEz2OCzBpJchbexJTle/hbHLqRQiPFBIoib7Os3/cSJsK72.ay', 'customer', 'active', '2025-08-28 15:33:21', '2025-08-28 15:33:21');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `products`
--
ALTER TABLE `products`
  ADD PRIMARY KEY (`product_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `products`
--
ALTER TABLE `products`
  MODIFY `product_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
