
type IconlyIconProps = {
    size?:number;
    color?:string;
    secondColor?:string;
}

export const IconlyPills = ({ size = 16, color = "currentColor", secondColor = "currentColor" }: IconlyIconProps) => {
    return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path fillRule="evenodd" clipRule="evenodd" d="M7.39281 9.10944C7.18127 8.93177 6.86573 8.95933 6.68818 9.17098L4.45871 11.8287C3.44771 13.0337 2.96671 14.5607 3.10371 16.1267C3.23971 17.6937 3.97971 19.1137 5.18371 20.1227C6.28371 21.0447 7.62571 21.4947 8.96171 21.4947C10.6427 21.4947 12.3127 20.7827 13.4757 19.4017L13.4767 19.4007L15.7056 16.7435C15.883 16.5321 15.8554 16.2168 15.6441 16.0393L7.39281 9.10944Z" fill={secondColor}></path>
		<path fillRule="evenodd" clipRule="evenodd" d="M20.8964 7.87274C20.7594 6.30574 20.0204 4.88574 18.8164 3.87674C16.3334 1.79474 12.6124 2.11974 10.5234 4.59874L8.29455 7.2559C8.11716 7.46738 8.14469 7.78259 8.35606 7.96011L16.6073 14.89C16.8189 15.0677 17.1344 15.0401 17.3119 14.8285L19.5414 12.1707C20.5514 10.9657 21.0334 9.43874 20.8964 7.87274Z" fill={secondColor}></path>
		</svg>
    ) 
}